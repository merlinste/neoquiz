// Öffentliche Konfiguration (anon-Key ist für den Client bestimmt; Zugriff nur über die RPC-Funktionen nq_*).
window.NQ_CONFIG = {
  supabaseUrl: "https://picjzrcacaxlkojwaxol.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpY2p6cmNhY2F4bGtvandheG9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0NjczMjIsImV4cCI6MjA3MjA0MzMyMn0.dFi0Dj0_ZkmQAU-XAPNvaslPXxLpMbdWpkzyl7RyA5A",
  evaluateEndpoint: "/api/evaluate",
  oralEndpoint: "/api/oral",
  oralProtocolEndpoint: "/.netlify/functions/oral-protocol-background",
  healthEndpoint: "/api/health",
};
