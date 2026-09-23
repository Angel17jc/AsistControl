-- CreateEnum
CREATE TYPE "VacationAccrual" AS ENUM ('ANNUAL', 'MONTHLY');

-- CreateEnum
CREATE TYPE "VacationDayCounting" AS ENUM ('CALENDAR_DAYS', 'WORKING_DAYS');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "contract_type_id" UUID;

-- CreateTable
CREATE TABLE "contract_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vacation_days_per_year" DECIMAL(5,2) NOT NULL,
    "vacation_accrual" "VacationAccrual" NOT NULL DEFAULT 'ANNUAL',
    "vacation_day_counting" "VacationDayCounting" NOT NULL DEFAULT 'WORKING_DAYS',
    "seniority_after_years" INTEGER,
    "seniority_extra_days_per_year" DECIMAL(4,2),
    "seniority_max_extra_days" DECIMAL(5,2),
    "allow_negative_vacation_balance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contract_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation_adjustments" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacation_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_types_name_key" ON "contract_types"("name");

-- CreateIndex
CREATE INDEX "vacation_adjustments_employee_id_created_at_idx" ON "vacation_adjustments"("employee_id", "created_at");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_contract_type_id_fkey" FOREIGN KEY ("contract_type_id") REFERENCES "contract_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_adjustments" ADD CONSTRAINT "vacation_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
