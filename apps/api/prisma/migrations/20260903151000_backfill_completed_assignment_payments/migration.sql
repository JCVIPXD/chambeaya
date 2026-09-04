-- Preserve the payment workflow for assignments completed before this link
-- existed. Existing rows remain direct-payment records until the company
-- reports them as processed.
INSERT INTO "Payment" (
  "id", "companyId", "shiftId", "assignmentId", "reference", "description",
  "amountCents", "workerCount", "status", "dueAt", "createdAt", "updatedAt"
)
SELECT
  md5('cumplenow-payment:' || assignment."id"),
  shift."companyId",
  assignment."shiftId",
  assignment."id",
  'CN-' || right(upper(assignment."shiftId"), 8) || '-' || right(upper(assignment."id"), 8),
  shift."title" || ' · ' || company."name",
  shift."payCents",
  1,
  'PENDING'::"PaymentStatus",
  COALESCE(assignment."completedAt", now()),
  COALESCE(assignment."completedAt", now()),
  COALESCE(assignment."completedAt", now())
FROM "ShiftAssignment" assignment
JOIN "Shift" shift ON shift."id" = assignment."shiftId"
JOIN "Company" company ON company."id" = shift."companyId"
WHERE assignment."status" = 'COMPLETED'::"AssignmentStatus"
  AND NOT EXISTS (
    SELECT 1 FROM "Payment" existing WHERE existing."assignmentId" = assignment."id"
  )
ON CONFLICT DO NOTHING;
