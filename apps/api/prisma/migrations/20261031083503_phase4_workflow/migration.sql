-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeasibilityRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "audience" "Audience" NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "incidence" DOUBLE PRECISION NOT NULL,
    "loi" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "cpi" DOUBLE PRECISION,
    "capacity" INTEGER,
    "note" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeasibilityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "completes" INTEGER NOT NULL,
    "cpi" DOUBLE PRECISION NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "completes" INTEGER NOT NULL,
    "cpi" DOUBLE PRECISION NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "toRef" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "adapter" TEXT,
    "approvalId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_createdAt_idx" ON "OutboxEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "FeasibilityRequest_tenantId_vendorId_status_idx" ON "FeasibilityRequest"("tenantId", "vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FeasibilityRequest_opportunityId_vendorId_country_key" ON "FeasibilityRequest"("opportunityId", "vendorId", "country");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_allocationId_key" ON "PurchaseOrder"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_number_key" ON "PurchaseOrder"("tenantId", "number");

-- CreateIndex
CREATE INDEX "Payable_tenantId_status_idx" ON "Payable"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_key_key" ON "MessageTemplate"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Message_tenantId_createdAt_idx" ON "Message"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
