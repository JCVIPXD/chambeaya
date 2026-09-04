-- Enrich each published shift with the information a worker needs before applying.
ALTER TABLE "Shift"
ADD COLUMN "description" TEXT,
ADD COLUMN "responsibilities" TEXT,
ADD COLUMN "requirements" TEXT,
ADD COLUMN "modality" TEXT NOT NULL DEFAULT 'PRESENCIAL';
