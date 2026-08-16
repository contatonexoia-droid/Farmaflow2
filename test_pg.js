import fs from 'fs';
import pkg from 'pg';
const { Client } = pkg;

// https://nalshjhoiecxooejpiaw.supabase.co
// Connection string for Supabase standard Postgres:
const conString = "postgresql://postgres.nalshjhoiecxooejpiaw:sb_secret_Fxi77yiQ9GbADKQOnZ1yeQ_YtvNdYZ3@aws-0-us-west-1.pooler.supabase.com:6543/postgres";
// Actually the postgres password is NOT the service role key. It's the DB password set by the user at creation.
