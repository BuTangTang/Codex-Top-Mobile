CREATE TABLE "PasswordCredential" (
    "accountId" TEXT NOT NULL,
    "loginName" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "clientSalt" TEXT NOT NULL,
    "verifierSalt" TEXT NOT NULL,
    "verifierHash" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("accountId"),
    CONSTRAINT "PasswordCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordCredential_loginName_key" ON "PasswordCredential"("loginName");
CREATE UNIQUE INDEX "PasswordCredential_credentialId_key" ON "PasswordCredential"("credentialId");
