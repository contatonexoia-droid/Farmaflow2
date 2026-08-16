const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const target = `    if (error) {
      console.error("[Team API] Erro ao criar usuário:", error);
      return res.status(400).json({ error: error.message });
    }`;

const replacement = `    if (error) {
      console.error("[Team API] Erro ao criar usuário:", error);
      let errorMessage = error.message;
      if (errorMessage.includes("A user with this email address has already been registered") || errorMessage.includes("email_exists") || errorMessage.includes("already registered")) {
        errorMessage = "Este endereço de e-mail já está sendo utilizado por outro usuário. Utilize um e-mail diferente.";
      }
      return res.status(400).json({ error: errorMessage });
    }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('server.ts', content);
  console.log("Patched Team API");
} else {
  console.log("Target not found");
}
