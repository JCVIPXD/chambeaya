CREATE TYPE "ReviewAuthorRole" AS ENUM ('WORKER', 'BUSINESS');

CREATE TABLE "AssignmentReview" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "authorRole" "ReviewAuthorRole" NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentReview_assignmentId_authorId_key" UNIQUE ("assignmentId", "authorId"),
  CONSTRAINT "AssignmentReview_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssignmentReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssignmentReview_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssignmentReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE INDEX "AssignmentReview_recipientId_createdAt_idx" ON "AssignmentReview"("recipientId", "createdAt");
