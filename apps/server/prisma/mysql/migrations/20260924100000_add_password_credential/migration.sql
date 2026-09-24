CREATE TABLE `PasswordCredential` (
    `accountId` VARCHAR(191) NOT NULL,
    `loginName` VARCHAR(191) NOT NULL,
    `credentialId` VARCHAR(191) NOT NULL,
    `clientSalt` VARCHAR(191) NOT NULL,
    `verifierSalt` VARCHAR(191) NOT NULL,
    `verifierHash` VARCHAR(191) NOT NULL,
    `envelope` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    CONSTRAINT `PasswordCredential_pkey` PRIMARY KEY (`accountId`),
    CONSTRAINT `PasswordCredential_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE UNIQUE INDEX `PasswordCredential_loginName_key` ON `PasswordCredential`(`loginName`);
CREATE UNIQUE INDEX `PasswordCredential_credentialId_key` ON `PasswordCredential`(`credentialId`);
