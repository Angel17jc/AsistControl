-- AlterEnum
ALTER TYPE "AttendanceAnomaly" ADD VALUE 'SHORT_HOURS';

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "short_minutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "work_shifts" ADD COLUMN     "flexible" BOOLEAN NOT NULL DEFAULT false;
