import { createClient } from "@supabase/supabase-js";

// Colle ici les deux informations récupérées sur ton tableau de bord Supabase
// (Project Settings > API Keys). La "Publishable key" est faite pour être
// utilisée directement dans le code du navigateur, pas de souci de sécurité.
const supabaseUrl = "https://zmscqzctsongskeozbfq.supabase.co";
const supabaseKey = "sb_publishable_gu2lPXbhQiBe_1r1zyIW5w_J9Iaoy0K";

export const supabase = createClient(supabaseUrl, supabaseKey);