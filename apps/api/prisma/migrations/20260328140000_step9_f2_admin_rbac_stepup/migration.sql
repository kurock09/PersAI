-- CreateEnum
CREATE TYPE "AppUserAdminRoleCode" AS ENUM ('ops_admin', 'business_admin', 'security_admin', 'super_admin');

-- CreateTable
CREATE TABLE "app_user_admin_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "role_code" "AppUserAdminRoleCode" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_admin_roles_user_id_workspace_id_role_code_key"
ON "app_user_admin_roles"("user_id", "workspace_id", "role_code");

-- CreateIndex
CREATE INDEX "app_user_admin_roles_workspace_id_role_code_idx"
ON "app_user_admin_roles"("workspace_id", "role_code");

-- AddForeignKey
ALTER TABLE "app_user_admin_roles"
ADD CONSTRAINT "app_user_admin_roles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user_admin_roles"
ADD CONSTRAINT "app_user_admin_roles_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
