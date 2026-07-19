import fs from 'fs';
let content = fs.readFileSync('App.tsx', 'utf-8');
content = content.replace(
`    } else if (parsed.access_token && parsed.refresh_token) {
        supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token }).catch(e => console.error("Failed to restore session", e));
    }`,
`    } else if (parsed.access_token && parsed.refresh_token) {
        supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token }).then(({ error }) => {
            if (error) {
                console.error("Session restore failed, logging out", error);
                localStorage.removeItem("ff_session");
                window.location.reload();
            }
        }).catch(e => console.error("Failed to restore session", e));
    }`
);
fs.writeFileSync('App.tsx', content);
