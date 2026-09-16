CREATE TABLE "WorkerTalentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "district" TEXT,
    "availabilityText" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerTalentProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerTalentSpecialty" (
    "profileId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkerTalentSpecialty_pkey" PRIMARY KEY ("profileId", "specialtyId")
);

CREATE UNIQUE INDEX "WorkerTalentProfile_userId_key" ON "WorkerTalentProfile"("userId");
CREATE INDEX "WorkerTalentProfile_isVisible_isAvailable_district_idx" ON "WorkerTalentProfile"("isVisible", "isAvailable", "district");
CREATE UNIQUE INDEX "Specialty_slug_key" ON "Specialty"("slug");
CREATE INDEX "Specialty_category_isActive_idx" ON "Specialty"("category", "isActive");
CREATE INDEX "WorkerTalentSpecialty_specialtyId_profileId_idx" ON "WorkerTalentSpecialty"("specialtyId", "profileId");

ALTER TABLE "WorkerTalentProfile" ADD CONSTRAINT "WorkerTalentProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerTalentSpecialty" ADD CONSTRAINT "WorkerTalentSpecialty_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "WorkerTalentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkerTalentSpecialty" ADD CONSTRAINT "WorkerTalentSpecialty_specialtyId_fkey"
  FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Specialty" ("id", "slug", "name", "category", "updatedAt") VALUES
  ('specialty_customer_service', 'atencion-al-cliente', 'Atención al cliente', 'Servicio', CURRENT_TIMESTAMP),
  ('specialty_waiting', 'mozo-mesero', 'Mozo / mesero', 'Hospitalidad', CURRENT_TIMESTAMP),
  ('specialty_barista', 'barista', 'Barista', 'Hospitalidad', CURRENT_TIMESTAMP),
  ('specialty_kitchen_assistant', 'asistente-de-cocina', 'Asistente de cocina', 'Gastronomía', CURRENT_TIMESTAMP),
  ('specialty_events', 'apoyo-en-eventos', 'Apoyo en eventos', 'Eventos', CURRENT_TIMESTAMP),
  ('specialty_retail', 'ventas-en-tienda', 'Ventas en tienda', 'Comercio', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
