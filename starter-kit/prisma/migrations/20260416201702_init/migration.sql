-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scanId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'scan_completed',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Notification" ("createdAt", "id", "message", "read", "title", "userId") SELECT "createdAt", "id", "message", "read", "title", "userId" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX "Notification_scanId_idx" ON "Notification"("scanId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
