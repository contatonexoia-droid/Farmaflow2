import fs from 'fs';
let content = fs.readFileSync('App.tsx', 'utf-8');
content = content.replace(
`    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setSession({ type: "GUEST" });
      }
    });`,
`    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") {
        setSession({ type: "GUEST" });
      } else if (event === "TOKEN_REFRESHED" && s) {
        setSession(prev => {
           if (prev.type === "GUEST") return prev;
           const updated = { ...prev, access_token: s.access_token, refresh_token: s.refresh_token };
           localStorage.setItem("ff_session", JSON.stringify(updated));
           return updated;
        });
      }
    });`
);
fs.writeFileSync('App.tsx', content);
