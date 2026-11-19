-- AlterEnum
ALTER TYPE "AttendanceAnomaly" ADD VALUE 'LONG_BREAK';

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "expected_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "long_break_minutes" INTEGER NOT NULL DEFAULT 0;
