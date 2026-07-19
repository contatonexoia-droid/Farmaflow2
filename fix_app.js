import fs from 'fs';
let content = fs.readFileSync('App.tsx', 'utf-8');
content = content.replace(
`    const parsed = saved ? JSON.parse(saved) : { type: "GUEST" };
    if (parsed.access_token && parsed.refresh_token) {
        supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token }).catch(e => console.error("Failed to restore session", e));
    }`,
`    let parsed = saved ? JSON.parse(saved) : { type: "GUEST" };
    if ((parsed.type === "SUPER_ADMIN" || parsed.type === "ADMIN") && (!parsed.access_token || !parsed.refresh_token)) {
        parsed = { type: "GUEST" };
        localStorage.removeItem("ff_session");
    } else if (parsed.access_token && parsed.refresh_token) {
        supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token }).catch(e => console.error("Failed to restore session", e));
    }`
);
fs.writeFileSync('App.tsx', content);
