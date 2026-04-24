-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('basic', 'pro', 'enterprise');

-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "access_token" TEXT NOT NULL,
    "storage_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dir_path" TEXT NOT NULL,
    "full_path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directories" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apps_access_token_key" ON "apps"("access_token");

-- CreateIndex
CREATE UNIQUE INDEX "files_app_id_full_path_key" ON "files"("app_id", "full_path");

-- CreateIndex
CREATE UNIQUE INDEX "directories_app_id_path_key" ON "directories"("app_id", "path");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directories" ADD CONSTRAINT "directories_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
