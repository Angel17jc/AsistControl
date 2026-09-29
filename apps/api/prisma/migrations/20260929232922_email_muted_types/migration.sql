-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_muted_types" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[];
