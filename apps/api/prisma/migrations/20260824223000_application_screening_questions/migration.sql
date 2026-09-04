ALTER TABLE "Shift"
ADD COLUMN "screeningQuestions" JSONB;

ALTER TABLE "ShiftApplication"
ADD COLUMN "screeningAnswers" JSONB;
