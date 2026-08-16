import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/v1/chat/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'nosso-catalogo'
      },
      body: JSON.stringify({
        conversation_id: '629d0f3e-a72a-455a-bcbe-c370f0554949',
        content: 'Teste backend para chat envio evolution API',
        sender_type: 'USER',
        is_private: false
      })
    });
    const json = await res.json();
    console.log(json);
  } catch (e) {
    console.error(e);
  }
}
test();
