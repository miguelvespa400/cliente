-- CRM: cadastro manual (lead sem campanha), negócio (valor, responsável, previsão) e tarefas.
-- SQLite não remove NOT NULL com ALTER TABLE: a tabela leads é recriada preservando os dados.
-- O DROP TABLE dispara o ON DELETE CASCADE de lead_activities, então o histórico é guardado
-- antes e restaurado depois.
PRAGMA defer_foreign_keys = true;

CREATE TABLE lead_activities_bak AS SELECT * FROM lead_activities;

CREATE TABLE leads_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  place_id TEXT,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  phone TEXT,
  email TEXT,
  website TEXT,
  rating TEXT,
  review_count INTEGER,
  category TEXT,
  source TEXT NOT NULL DEFAULT 'google_places',
  reference_url TEXT,
  has_website INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'LOW',
  ai_analysis TEXT,
  marketing_content TEXT,
  crm_status TEXT NOT NULL DEFAULT 'new',
  crm_notes TEXT,
  contact_name TEXT,
  deal_value REAL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expected_close_date TEXT,
  scraped_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (campaign_id, place_id)
);

INSERT INTO leads_new (
  id, workspace_id, campaign_id, place_id, name, address, lat, lng, phone, email, website, rating, review_count, category,
  source, reference_url, has_website, score, priority, ai_analysis, marketing_content, crm_status, crm_notes,
  scraped_at, created_at, updated_at
)
SELECT
  id, workspace_id, campaign_id, place_id, name, address, lat, lng, phone, email, website, rating, review_count, category,
  source, reference_url, has_website, score, priority, ai_analysis, marketing_content, crm_status, crm_notes,
  scraped_at, created_at, updated_at
FROM leads;

DROP TABLE leads;
ALTER TABLE leads_new RENAME TO leads;

DELETE FROM lead_activities;
INSERT INTO lead_activities (id, lead_id, type, note, created_at)
  SELECT id, lead_id, type, note, created_at FROM lead_activities_bak;
DROP TABLE lead_activities_bak;

CREATE INDEX idx_leads_ws ON leads (workspace_id, score);
CREATE INDEX idx_leads_campaign ON leads (campaign_id);
CREATE INDEX idx_leads_status ON leads (workspace_id, crm_status, updated_at);
CREATE INDEX idx_leads_owner ON leads (owner_id);

-- Tarefas/lembretes (ligar, WhatsApp, e-mail, reunião, visita...) de um lead.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'call',
  note TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tasks_ws ON tasks (workspace_id, done, scheduled_at);
CREATE INDEX idx_tasks_lead ON tasks (lead_id, done, scheduled_at);
