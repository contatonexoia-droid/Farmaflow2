const fs = require('fs');
let code = fs.readFileSync('App.tsx', 'utf8');

const targetStr = `  useEffect(() => {
    if (session.type !== "GUEST" && session.access_token && session.refresh_token) {
      supabase.auth.setSession({ 
        access_token: session.access_token, 
        refresh_token: session.refresh_token 
      }).then(({ data, error }) => {
        if (error || !data.session) {
          console.warn("Supabase session missing or error. Logging out.", error);
          setSession({ type: "GUEST" });
          localStorage.removeItem("ff_session");
        }
      });
    } else if (session.type !== "GUEST") {
        setSession({ type: "GUEST" });
        localStorage.removeItem("ff_session");
    }
  }, []);`;

const newStr = `  useEffect(() => {
    if (session.type === "GUEST") return;

    // Use getSession to rely on Supabase's native storage and auto-refresh,
    // avoiding race conditions with manual setSession.
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        // If it's a network error, do not log the user out.
        if (error.message && (error.message.includes('fetch') || error.message.includes('network'))) {
          console.warn("Network error during auth check. Keeping current session state.");
          return;
        }
        console.warn("Supabase session error. Logging out.", error);
        setSession({ type: "GUEST" });
        localStorage.removeItem("ff_session");
      } else if (!data.session) {
        // Se realmente não há sessão no Supabase, loga fora
        console.warn("Supabase session missing. Logging out.");
        setSession({ type: "GUEST" });
        localStorage.removeItem("ff_session");
      } else {
        // Sync just in case
        setSession(prev => {
          if (prev.type === "GUEST") return prev;
          const updated = { ...prev, access_token: data.session.access_token, refresh_token: data.session.refresh_token };
          localStorage.setItem("ff_session", JSON.stringify(updated));
          return updated;
        });
      }
    });
  }, []);`;

code = code.replace(targetStr, newStr);
fs.writeFileSync('App.tsx', code);
