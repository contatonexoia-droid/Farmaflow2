import dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

async function run() {
  try {
    const ips = await resolve4('nalshjhoiecxooejpiaw.supabase.co');
    console.log('SUPABASE URL IPs:', ips);
  } catch (err) {
    console.error('Resolve failed:', err);
  }
}
run();
