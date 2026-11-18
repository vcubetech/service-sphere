const jsonResponse = (description: string, schema = 'JsonObject') => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${schema}` },
    },
  },
});

const requestBody = (schema: string) => ({
  required: true,
  content: {
    'application/json': {
      schema: { $ref: `#/components/schemas/${schema}` },
    },
  },
});

const pathId = (name = 'id', description = 'Record ID') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});

const jsonError = jsonResponse('Request or server error', 'ApiError');
const commonErrors = {
  '400': jsonError,
  '401': jsonError,
  '403': jsonError,
  '404': jsonError,
  '409': jsonError,
  '500': jsonError,
};
const secured = [{ bearerAuth: [] }];

const record = (properties: Record<string, unknown> = {}) => ({
  type: 'object',
  properties,
  additionalProperties: true,
});
const list = (schema: string) => ({
  type: 'array',
  items: { $ref: `#/components/schemas/${schema}` },
});
const reference = (schema: string) => ({
  $ref: `#/components/schemas/${schema}`,
});
const nullableReference = (schema: string) => ({
  allOf: [reference(schema)],
  nullable: true,
});
const stringField = (format?: string) =>
  format ? { type: 'string', format } : { type: 'string' };
const amountField = {
  oneOf: [{ type: 'number' }, { type: 'string' }],
  description: 'Decimal amount; serialized as a JSON number or decimal string.',
};

const openapi = {
  openapi: '3.0.0',
  info: {
    title: 'Tax Filing Services API',
    version: '1.0.0',
    description:
      'Tax filing service endpoints. Protected endpoints require a JWT bearer token.',
  },
  servers: [{ url: '/api', description: 'API base path' }],
  tags: [
    { name: 'Health' },
    { name: 'Authentication' },
    { name: 'Customers' },
    { name: 'Auditors' },
    { name: 'Tax returns' },
    { name: 'Documents' },
    { name: 'Audits' },
    { name: 'Payments' },
    { name: 'Administration' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                path: { type: 'array', items: {} },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      JsonObject: record(),
      HealthResponse: {
        type: 'object',
        required: ['status', 'service'],
        properties: {
          status: { type: 'string', example: 'ok' },
          service: { type: 'string', example: 'tax-filing-api' },
        },
      },
      RegisterInput: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', minLength: 7, maxLength: 20 },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          role: {
            type: 'string',
            enum: ['CUSTOMER', 'AUDITOR'],
            default: 'CUSTOMER',
          },
          panNumber: {
            type: 'string',
            pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$',
            description: 'Required when role is CUSTOMER.',
          },
          membershipNumber: { type: 'string', maxLength: 100 },
          firmName: { type: 'string', maxLength: 200 },
          qualification: { type: 'string', maxLength: 200 },
          experienceYears: { type: 'integer', minimum: 0, maximum: 80 },
          city: { type: 'string', maxLength: 100 },
        },
      },
      LoginInput: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
      LoginResponse: {
        type: 'object',
        required: ['token', 'user'],
        properties: {
          token: { type: 'string', description: 'JWT bearer token.' },
          user: record({
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['CUSTOMER', 'AUDITOR', 'ADMIN'] },
          }),
        },
      },
      User: {
        ...record({
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['CUSTOMER', 'AUDITOR', 'ADMIN'] },
          isActive: { type: 'boolean' },
          createdAt: stringField('date-time'),
          updatedAt: stringField('date-time'),
          customer: nullableReference('Customer'),
          auditor: nullableReference('Auditor'),
          uploadedDocuments: list('Document'),
          payments: list('Payment'),
        }),
        description:
          'User API response. The database passwordHash field is never exposed.',
      },
      Customer: record({
        id: { type: 'string' },
        userId: { type: 'string' },
        panNumber: { type: 'string' },
        aadhaarNumber: { type: 'string', nullable: true },
        dateOfBirth: { type: 'string', format: 'date-time', nullable: true },
        taxpayerType: {
          type: 'string',
          enum: ['INDIVIDUAL', 'HUF', 'FIRM', 'LLP', 'COMPANY', 'TRUST', 'AOP', 'BOI'],
        },
        fatherName: { type: 'string', nullable: true },
        address: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
        state: { type: 'string', nullable: true },
        pincode: { type: 'string', nullable: true },
        businessName: { type: 'string', nullable: true },
        gstNumber: { type: 'string', nullable: true },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        user: reference('User'),
        taxReturns: list('TaxReturn'),
        documents: list('Document'),
      }),
      Auditor: record({
        id: { type: 'string' },
        userId: { type: 'string' },
        membershipNumber: { type: 'string', nullable: true },
        firmName: { type: 'string', nullable: true },
        qualification: { type: 'string', nullable: true },
        experienceYears: { type: 'integer' },
        status: {
          type: 'string',
          enum: ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'],
        },
        city: { type: 'string', nullable: true },
        isAvailable: { type: 'boolean' },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        user: reference('User'),
        taxReturns: list('TaxReturn'),
        auditAssignments: list('AuditAssignment'),
      }),
      FinancialYear: record({
        id: { type: 'string' },
        financialYear: { type: 'string' },
        assessmentYear: { type: 'string' },
        startDate: stringField('date-time'),
        endDate: stringField('date-time'),
        filingDueDate: { type: 'string', format: 'date-time', nullable: true },
        isActive: { type: 'boolean' },
        createdAt: stringField('date-time'),
        taxReturns: list('TaxReturn'),
      }),
      TaxReturn: record({
        id: { type: 'string' },
        returnNumber: { type: 'string' },
        customerId: { type: 'string' },
        auditorId: { type: 'string', nullable: true },
        financialYearId: { type: 'string' },
        itrForm: {
          type: 'string',
          enum: ['ITR_1', 'ITR_2', 'ITR_3', 'ITR_4', 'ITR_5', 'ITR_6', 'ITR_7'],
          nullable: true,
        },
        filingType: { type: 'string', enum: ['ORIGINAL', 'REVISED', 'BELATED', 'UPDATED'] },
        taxRegime: { type: 'string', enum: ['OLD_REGIME', 'NEW_REGIME'] },
        status: {
          type: 'string',
          enum: [
            'DRAFT',
            'DOCUMENT_PENDING',
            'UNDER_REVIEW',
            'QUERY_RAISED',
            'APPROVED',
            'READY_TO_FILE',
            'FILED',
            'VERIFIED',
            'COMPLETED',
            'REJECTED',
          ],
        },
        totalIncome: amountField,
        totalDeductions: amountField,
        taxableIncome: amountField,
        taxAmount: amountField,
        taxPaid: amountField,
        refundAmount: amountField,
        acknowledgementNumber: { type: 'string', nullable: true },
        filedAt: { type: 'string', format: 'date-time', nullable: true },
        verifiedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        customer: reference('Customer'),
        auditor: nullableReference('Auditor'),
        financialYear: reference('FinancialYear'),
        incomeDetails: list('IncomeDetail'),
        deductions: list('Deduction'),
        taxComputation: nullableReference('TaxComputation'),
        documents: list('Document'),
        auditAssignment: nullableReference('AuditAssignment'),
        filingHistories: list('FilingHistory'),
        payments: list('Payment'),
      }),
      IncomeDetail: record({
        id: { type: 'string' },
        taxReturnId: { type: 'string' },
        incomeType: {
          type: 'string',
          enum: ['SALARY', 'HOUSE_PROPERTY', 'BUSINESS', 'CAPITAL_GAINS', 'OTHER_SOURCES'],
        },
        description: { type: 'string', nullable: true },
        employerName: { type: 'string', nullable: true },
        grossAmount: amountField,
        taxableAmount: amountField,
        tdsAmount: amountField,
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        taxReturn: reference('TaxReturn'),
      }),
      Deduction: record({
        id: { type: 'string' },
        taxReturnId: { type: 'string' },
        section: { type: 'string' },
        description: { type: 'string', nullable: true },
        amount: amountField,
        eligibleAmount: amountField,
        createdAt: stringField('date-time'),
        taxReturn: reference('TaxReturn'),
      }),
      TaxComputation: record({
        id: { type: 'string' },
        taxReturnId: { type: 'string' },
        grossTotalIncome: amountField,
        exemptIncome: amountField,
        deductions: amountField,
        taxableIncome: amountField,
        basicTax: amountField,
        surcharge: amountField,
        cess: amountField,
        rebate: amountField,
        tds: amountField,
        advanceTax: amountField,
        selfAssessmentTax: amountField,
        finalTax: amountField,
        calculatedAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        taxReturn: reference('TaxReturn'),
      }),
      Document: record({
        id: { type: 'string' },
        customerId: { type: 'string' },
        taxReturnId: { type: 'string', nullable: true },
        uploadedById: { type: 'string' },
        documentType: {
          type: 'string',
          enum: [
            'PAN_CARD',
            'AADHAAR_CARD',
            'FORM_16',
            'BANK_STATEMENT',
            'SALARY_SLIP',
            'FORM_26AS',
            'AIS',
            'TIS',
            'INVESTMENT_PROOF',
            'BUSINESS_PROOF',
            'BALANCE_SHEET',
            'PROFIT_LOSS',
            'AUDIT_REPORT',
            'OTHER',
          ],
        },
        fileName: { type: 'string' },
        fileUrl: { type: 'string', format: 'uri' },
        fileSize: { type: 'integer', nullable: true },
        mimeType: { type: 'string', nullable: true },
        status: { type: 'string', enum: ['UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] },
        remarks: { type: 'string', nullable: true },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        customer: reference('Customer'),
        taxReturn: nullableReference('TaxReturn'),
        uploadedBy: reference('User'),
      }),
      AuditAssignment: record({
        id: { type: 'string' },
        taxReturnId: { type: 'string' },
        auditorId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'QUERY_RAISED', 'APPROVED', 'COMPLETED', 'REJECTED'],
        },
        assignedAt: stringField('date-time'),
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        taxReturn: reference('TaxReturn'),
        auditor: reference('Auditor'),
        findings: list('AuditFinding'),
        report: nullableReference('AuditReport'),
      }),
      AuditFinding: record({
        id: { type: 'string' },
        assignmentId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
        recommendation: { type: 'string', nullable: true },
        isResolved: { type: 'boolean' },
        resolvedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        assignment: reference('AuditAssignment'),
      }),
      AuditReport: record({
        id: { type: 'string' },
        assignmentId: { type: 'string' },
        reportNumber: { type: 'string' },
        reportUrl: { type: 'string', format: 'uri', nullable: true },
        remarks: { type: 'string', nullable: true },
        issuedAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: stringField('date-time'),
        assignment: reference('AuditAssignment'),
      }),
      FilingHistory: record({
        id: { type: 'string' },
        taxReturnId: { type: 'string' },
        previousStatus: {
          type: 'string',
          enum: [
            'DRAFT',
            'DOCUMENT_PENDING',
            'UNDER_REVIEW',
            'QUERY_RAISED',
            'APPROVED',
            'READY_TO_FILE',
            'FILED',
            'VERIFIED',
            'COMPLETED',
            'REJECTED',
          ],
          nullable: true,
        },
        currentStatus: {
          type: 'string',
          enum: [
            'DRAFT',
            'DOCUMENT_PENDING',
            'UNDER_REVIEW',
            'QUERY_RAISED',
            'APPROVED',
            'READY_TO_FILE',
            'FILED',
            'VERIFIED',
            'COMPLETED',
            'REJECTED',
          ],
        },
        remarks: { type: 'string', nullable: true },
        changedBy: { type: 'string', nullable: true },
        changedAt: stringField('date-time'),
        taxReturn: reference('TaxReturn'),
      }),
      Payment: record({
        id: { type: 'string' },
        taxReturnId: { type: 'string' },
        userId: { type: 'string' },
        amount: amountField,
        status: { type: 'string', enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] },
        method: {
          type: 'string',
          enum: ['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER'],
          nullable: true,
        },
        provider: { type: 'string', nullable: true },
        reference: { type: 'string', nullable: true },
        createdAt: stringField('date-time'),
        updatedAt: stringField('date-time'),
        taxReturn: reference('TaxReturn'),
        user: reference('User'),
      }),
      RegisterResponse: record({
        user: { $ref: '#/components/schemas/User' },
        profile: {
          oneOf: [
            reference('Customer'),
            reference('Auditor'),
          ],
          description: 'Customer or auditor profile, depending on the registered role.',
        },
        message: { type: 'string' },
      }),
      CustomerPatchInput: {
        type: 'object',
        minProperties: 1,
        properties: {
          aadhaarNumber: { type: 'string', pattern: '^[0-9]{12}$' },
          dateOfBirth: stringField('date-time'),
          taxpayerType: {
            type: 'string',
            enum: ['INDIVIDUAL', 'HUF', 'FIRM', 'LLP', 'COMPANY', 'TRUST', 'AOP', 'BOI'],
          },
          fatherName: { type: 'string', maxLength: 150, nullable: true },
          address: { type: 'string', maxLength: 500, nullable: true },
          city: { type: 'string', maxLength: 100, nullable: true },
          state: { type: 'string', maxLength: 100, nullable: true },
          pincode: { type: 'string', maxLength: 20, nullable: true },
          businessName: { type: 'string', maxLength: 200, nullable: true },
          gstNumber: { type: 'string', maxLength: 20, nullable: true },
        },
        additionalProperties: false,
      },
      AuditorPatchInput: {
        type: 'object',
        minProperties: 1,
        properties: {
          membershipNumber: { type: 'string', maxLength: 100, nullable: true },
          firmName: { type: 'string', maxLength: 200, nullable: true },
          qualification: { type: 'string', maxLength: 200, nullable: true },
          experienceYears: { type: 'integer', minimum: 0, maximum: 80 },
          city: { type: 'string', maxLength: 100, nullable: true },
        },
        additionalProperties: false,
      },
      AuditorStatusInput: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED'] },
        },
      },
      FinancialYearInput: {
        type: 'object',
        required: ['financialYear', 'assessmentYear', 'startDate', 'endDate'],
        properties: {
          financialYear: { type: 'string', minLength: 4, maxLength: 20 },
          assessmentYear: { type: 'string', minLength: 4, maxLength: 20 },
          startDate: stringField('date-time'),
          endDate: stringField('date-time'),
          filingDueDate: stringField('date-time'),
          isActive: { type: 'boolean' },
        },
      },
      FinancialYearPatchInput: {
        type: 'object',
        minProperties: 1,
        properties: {
          financialYear: { type: 'string', minLength: 4, maxLength: 20 },
          assessmentYear: { type: 'string', minLength: 4, maxLength: 20 },
          startDate: stringField('date-time'),
          endDate: stringField('date-time'),
          filingDueDate: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      TaxReturnCreateInput: {
        type: 'object',
        required: ['financialYearId'],
        properties: {
          financialYearId: { type: 'string' },
          itrForm: {
            type: 'string',
            enum: ['ITR_1', 'ITR_2', 'ITR_3', 'ITR_4', 'ITR_5', 'ITR_6', 'ITR_7'],
          },
          filingType: { type: 'string', enum: ['ORIGINAL', 'REVISED', 'BELATED', 'UPDATED'] },
          taxRegime: { type: 'string', enum: ['OLD_REGIME', 'NEW_REGIME'] },
        },
      },
      TaxReturnPatchInput: {
        type: 'object',
        minProperties: 1,
        properties: {
          itrForm: {
            type: 'string',
            enum: ['ITR_1', 'ITR_2', 'ITR_3', 'ITR_4', 'ITR_5', 'ITR_6', 'ITR_7'],
            nullable: true,
          },
          filingType: { type: 'string', enum: ['ORIGINAL', 'REVISED', 'BELATED', 'UPDATED'] },
          taxRegime: { type: 'string', enum: ['OLD_REGIME', 'NEW_REGIME'] },
        },
        additionalProperties: false,
      },
      TaxReturnStatusInput: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['READY_TO_FILE', 'FILED', 'VERIFIED', 'COMPLETED', 'REJECTED'],
          },
          acknowledgementNumber: { type: 'string', minLength: 1, maxLength: 100 },
          remarks: { type: 'string', maxLength: 1000 },
        },
      },
      TaxComputationInput: {
        type: 'object',
        required: [
          'grossTotalIncome',
          'exemptIncome',
          'deductions',
          'taxableIncome',
          'basicTax',
          'surcharge',
          'cess',
          'rebate',
          'tds',
          'advanceTax',
          'selfAssessmentTax',
          'finalTax',
        ],
        properties: {
          grossTotalIncome: { type: 'number', minimum: 0 },
          exemptIncome: { type: 'number', minimum: 0 },
          deductions: { type: 'number', minimum: 0 },
          taxableIncome: { type: 'number', minimum: 0 },
          basicTax: { type: 'number', minimum: 0 },
          surcharge: { type: 'number', minimum: 0 },
          cess: { type: 'number', minimum: 0 },
          rebate: { type: 'number', minimum: 0 },
          tds: { type: 'number', minimum: 0 },
          advanceTax: { type: 'number', minimum: 0 },
          selfAssessmentTax: { type: 'number', minimum: 0 },
          finalTax: { type: 'number', minimum: 0 },
        },
      },
      IncomeInput: {
        type: 'object',
        required: ['incomeType', 'grossAmount', 'taxableAmount'],
        properties: {
          incomeType: {
            type: 'string',
            enum: ['SALARY', 'HOUSE_PROPERTY', 'BUSINESS', 'CAPITAL_GAINS', 'OTHER_SOURCES'],
          },
          description: { type: 'string', maxLength: 500 },
          employerName: { type: 'string', maxLength: 200 },
          grossAmount: { type: 'number', minimum: 0 },
          taxableAmount: { type: 'number', minimum: 0 },
          tdsAmount: { type: 'number', minimum: 0, default: 0 },
        },
      },
      DeductionInput: {
        type: 'object',
        required: ['section', 'amount', 'eligibleAmount'],
        properties: {
          section: { type: 'string', minLength: 1, maxLength: 30 },
          description: { type: 'string', maxLength: 500 },
          amount: { type: 'number', minimum: 0 },
          eligibleAmount: { type: 'number', minimum: 0 },
        },
      },
      DocumentInput: {
        type: 'object',
        required: ['documentType', 'fileName', 'fileUrl'],
        properties: {
          taxReturnId: { type: 'string' },
          documentType: {
            type: 'string',
            enum: [
              'PAN_CARD',
              'AADHAAR_CARD',
              'FORM_16',
              'BANK_STATEMENT',
              'SALARY_SLIP',
              'FORM_26AS',
              'AIS',
              'TIS',
              'INVESTMENT_PROOF',
              'BUSINESS_PROOF',
              'BALANCE_SHEET',
              'PROFIT_LOSS',
              'AUDIT_REPORT',
              'OTHER',
            ],
          },
          fileName: { type: 'string', minLength: 1, maxLength: 255 },
          fileUrl: { type: 'string', format: 'uri', maxLength: 2048 },
          fileSize: { type: 'integer', minimum: 1 },
          mimeType: { type: 'string', maxLength: 100 },
        },
      },
      DocumentReviewInput: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'] },
          remarks: { type: 'string', maxLength: 1000 },
        },
      },
      AssignmentInput: {
        type: 'object',
        required: ['taxReturnId', 'auditorId'],
        properties: {
          taxReturnId: { type: 'string', minLength: 1 },
          auditorId: { type: 'string', minLength: 1 },
        },
      },
      AssignmentStatusInput: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['ASSIGNED', 'IN_PROGRESS', 'QUERY_RAISED', 'APPROVED', 'COMPLETED', 'REJECTED'],
          },
        },
      },
      FindingInput: {
        type: 'object',
        required: ['title', 'description'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 5000 },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          recommendation: { type: 'string', maxLength: 5000 },
        },
      },
      FindingResolutionInput: {
        type: 'object',
        required: ['isResolved'],
        properties: { isResolved: { type: 'boolean' } },
      },
      AuditReportInput: {
        type: 'object',
        properties: {
          reportNumber: { type: 'string', minLength: 1, maxLength: 100 },
          reportUrl: { type: 'string', format: 'uri', maxLength: 2048 },
          remarks: { type: 'string', maxLength: 5000 },
        },
      },
      PaymentInput: {
        type: 'object',
        required: ['taxReturnId', 'amount'],
        properties: {
          taxReturnId: { type: 'string', minLength: 1 },
          amount: {
            type: 'number',
            minimum: 0,
            exclusiveMinimum: true,
            maximum: 10000000,
          },
          method: {
            type: 'string',
            enum: ['UPI', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER'],
          },
        },
      },
      PaymentStatusInput: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['PAID', 'FAILED', 'REFUNDED'] } },
      },
      Dashboard: {
        type: 'object',
        required: ['customers', 'auditors', 'taxReturns', 'paidPaymentsTotal'],
        properties: {
          customers: { type: 'integer' },
          auditors: { type: 'integer' },
          taxReturns: { type: 'integer' },
          paidPaymentsTotal: amountField,
        },
      },
      TaxReturnList: {
        type: 'object',
        required: ['data', 'page', 'limit', 'total'],
        properties: {
          data: list('TaxReturn'),
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
      PaymentCreateResponse: {
        type: 'object',
        required: ['payment', 'message'],
        properties: {
          payment: { $ref: '#/components/schemas/Payment' },
          message: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Returns service status. No authentication or parameters required.',
        responses: {
          '200': jsonResponse('Service is healthy', 'HealthResponse'),
          '500': jsonError,
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a customer or auditor',
        requestBody: requestBody('RegisterInput'),
        responses: {
          '201': jsonResponse('Account created', 'RegisterResponse'),
          '400': jsonError,
          '409': jsonError,
          '500': jsonError,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in and receive a JWT',
        requestBody: requestBody('LoginInput'),
        responses: {
          '200': jsonResponse('Login successful', 'LoginResponse'),
          '400': jsonError,
          '401': jsonError,
          '403': jsonError,
          '500': jsonError,
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get the authenticated user and profile',
        security: secured,
        responses: {
          '200': jsonResponse('Authenticated user', 'User'),
          ...commonErrors,
        },
      },
    },
    '/customers/me': {
      get: {
        tags: ['Customers'],
        summary: 'Get the current customer profile',
        security: secured,
        responses: {
          '200': jsonResponse('Customer profile', 'Customer'),
          ...commonErrors,
        },
      },
      patch: {
        tags: ['Customers'],
        summary: 'Update the current customer profile',
        security: secured,
        requestBody: requestBody('CustomerPatchInput'),
        responses: {
          '200': jsonResponse('Updated customer profile', 'Customer'),
          ...commonErrors,
        },
      },
    },
    '/auditors/me': {
      get: {
        tags: ['Auditors'],
        summary: 'Get the current auditor profile',
        security: secured,
        responses: {
          '200': jsonResponse('Auditor profile', 'Auditor'),
          ...commonErrors,
        },
      },
      patch: {
        tags: ['Auditors'],
        summary: 'Update the current auditor profile',
        security: secured,
        requestBody: requestBody('AuditorPatchInput'),
        responses: {
          '200': jsonResponse('Updated auditor profile', 'Auditor'),
          ...commonErrors,
        },
      },
    },
    '/auditors': {
      get: {
        tags: ['Auditors'],
        summary: 'List auditors (admin only)',
        security: secured,
        responses: {
          '200': {
            description: 'Auditors ordered by creation time, with user identity.',
            content: { 'application/json': { schema: list('Auditor') } },
          },
          ...commonErrors,
        },
      },
    },
    '/auditors/{id}/status': {
      patch: {
        tags: ['Auditors'],
        summary: 'Change auditor verification status (admin only)',
        security: secured,
        parameters: [pathId('id', 'Auditor ID')],
        requestBody: requestBody('AuditorStatusInput'),
        responses: {
          '200': jsonResponse('Updated auditor', 'Auditor'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/financial-years': {
      get: {
        tags: ['Tax returns'],
        summary: 'List active financial years',
        security: secured,
        responses: {
          '200': {
            description: 'Active financial years, newest first.',
            content: { 'application/json': { schema: list('FinancialYear') } },
          },
          ...commonErrors,
        },
      },
    },
    '/tax-returns': {
      get: {
        tags: ['Tax returns'],
        summary: 'List tax returns visible to the authenticated user',
        security: secured,
        parameters: [
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          '200': jsonResponse('Paginated tax returns', 'TaxReturnList'),
          ...commonErrors,
        },
      },
      post: {
        tags: ['Tax returns'],
        summary: 'Create a draft tax return (customer only)',
        security: secured,
        requestBody: requestBody('TaxReturnCreateInput'),
        responses: {
          '201': jsonResponse('Created tax return', 'TaxReturn'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/{id}': {
      get: {
        tags: ['Tax returns'],
        summary: 'Get visible tax return details',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        responses: {
          '200': jsonResponse('Tax return with financial year, income, deductions, documents, audit, and history', 'TaxReturn'),
          ...commonErrors,
        },
      },
      patch: {
        tags: ['Tax returns'],
        summary: 'Update a draft or query-raised return (customer only)',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        requestBody: requestBody('TaxReturnPatchInput'),
        responses: {
          '200': jsonResponse('Updated tax return', 'TaxReturn'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/{id}/submit': {
      post: {
        tags: ['Tax returns'],
        summary: 'Submit a tax return for review (customer only)',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        responses: {
          '200': jsonResponse('Submitted tax return', 'TaxReturn'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/{id}/status': {
      patch: {
        tags: ['Tax returns'],
        summary: 'Advance tax return filing status (admin only)',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        requestBody: requestBody('TaxReturnStatusInput'),
        responses: {
          '200': jsonResponse('Updated tax return status', 'TaxReturn'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/{id}/computation': {
      put: {
        tags: ['Tax returns'],
        summary: 'Create or replace tax computation (assigned auditor or admin)',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        requestBody: requestBody('TaxComputationInput'),
        responses: {
          '200': jsonResponse('Saved tax computation', 'TaxComputation'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/{id}/income': {
      post: {
        tags: ['Tax returns'],
        summary: 'Add income to an editable return (customer only)',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        requestBody: requestBody('IncomeInput'),
        responses: {
          '201': jsonResponse('Created income detail', 'IncomeDetail'),
          ...commonErrors,
        },
      },
    },
    '/tax-returns/{id}/deductions': {
      post: {
        tags: ['Tax returns'],
        summary: 'Add deduction to an editable return (customer only)',
        security: secured,
        parameters: [pathId('id', 'Tax return ID')],
        requestBody: requestBody('DeductionInput'),
        responses: {
          '201': jsonResponse('Created deduction', 'Deduction'),
          ...commonErrors,
        },
      },
    },
    '/documents': {
      get: {
        tags: ['Documents'],
        summary: 'List documents visible to the authenticated user',
        security: secured,
        responses: {
          '200': {
            description: 'Accessible documents, newest first.',
            content: { 'application/json': { schema: list('Document') } },
          },
          ...commonErrors,
        },
      },
      post: {
        tags: ['Documents'],
        summary: 'Add document metadata (customer only; does not upload a file)',
        security: secured,
        requestBody: requestBody('DocumentInput'),
        responses: {
          '201': jsonResponse('Created document metadata', 'Document'),
          ...commonErrors,
        },
      },
    },
    '/documents/{id}/review': {
      patch: {
        tags: ['Documents'],
        summary: 'Review a document (assigned auditor or admin)',
        security: secured,
        parameters: [pathId('id', 'Document ID')],
        requestBody: requestBody('DocumentReviewInput'),
        responses: {
          '200': jsonResponse('Updated document', 'Document'),
          ...commonErrors,
        },
      },
    },
    '/audits/assignments': {
      get: {
        tags: ['Audits'],
        summary: 'List assignments visible to the authenticated user',
        security: secured,
        responses: {
          '200': {
            description: 'Assignments with return, auditor, findings, and report details.',
            content: { 'application/json': { schema: list('AuditAssignment') } },
          },
          ...commonErrors,
        },
      },
      post: {
        tags: ['Audits'],
        summary: 'Assign a verified and available auditor (admin only)',
        security: secured,
        requestBody: requestBody('AssignmentInput'),
        responses: {
          '201': jsonResponse('Created audit assignment', 'AuditAssignment'),
          ...commonErrors,
        },
      },
    },
    '/audits/assignments/{id}/status': {
      patch: {
        tags: ['Audits'],
        summary: 'Update assignment status (assigned auditor or admin)',
        security: secured,
        parameters: [pathId('id', 'Audit assignment ID')],
        requestBody: requestBody('AssignmentStatusInput'),
        responses: {
          '200': jsonResponse('Updated audit assignment', 'AuditAssignment'),
          ...commonErrors,
        },
      },
    },
    '/audits/assignments/{id}/findings': {
      post: {
        tags: ['Audits'],
        summary: 'Add a finding to an assignment (assigned auditor or admin)',
        security: secured,
        parameters: [pathId('id', 'Audit assignment ID')],
        requestBody: requestBody('FindingInput'),
        responses: {
          '201': jsonResponse('Created audit finding', 'AuditFinding'),
          ...commonErrors,
        },
      },
    },
    '/audits/assignments/{id}/findings/{findingId}': {
      patch: {
        tags: ['Audits'],
        summary: 'Resolve or reopen an audit finding (assigned auditor or admin)',
        security: secured,
        parameters: [
          pathId('id', 'Audit assignment ID'),
          pathId('findingId', 'Audit finding ID'),
        ],
        requestBody: requestBody('FindingResolutionInput'),
        responses: {
          '200': jsonResponse('Updated audit finding', 'AuditFinding'),
          ...commonErrors,
        },
      },
    },
    '/audits/assignments/{id}/report': {
      put: {
        tags: ['Audits'],
        summary: 'Create or update an audit report (assigned auditor or admin)',
        security: secured,
        parameters: [pathId('id', 'Audit assignment ID')],
        requestBody: requestBody('AuditReportInput'),
        responses: {
          '200': jsonResponse('Saved audit report', 'AuditReport'),
          ...commonErrors,
        },
      },
    },
    '/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payments visible to the authenticated user',
        security: secured,
        responses: {
          '200': {
            description: 'Payments newest first with tax return summary.',
            content: { 'application/json': { schema: list('Payment') } },
          },
          ...commonErrors,
        },
      },
      post: {
        tags: ['Payments'],
        summary: 'Record a pending payment (customer only; no gateway charge)',
        security: secured,
        requestBody: requestBody('PaymentInput'),
        responses: {
          '201': jsonResponse('Created pending payment', 'PaymentCreateResponse'),
          ...commonErrors,
        },
      },
    },
    '/payments/{id}/status': {
      patch: {
        tags: ['Payments'],
        summary: 'Update payment status (admin only)',
        security: secured,
        parameters: [pathId('id', 'Payment ID')],
        requestBody: requestBody('PaymentStatusInput'),
        responses: {
          '200': jsonResponse('Updated payment', 'Payment'),
          ...commonErrors,
        },
      },
    },
    '/admin/dashboard': {
      get: {
        tags: ['Administration'],
        summary: 'Get administrative dashboard totals',
        security: secured,
        responses: {
          '200': jsonResponse('Dashboard summary', 'Dashboard'),
          ...commonErrors,
        },
      },
    },
    '/admin/financial-years': {
      get: {
        tags: ['Administration'],
        summary: 'List financial years (admin only)',
        security: secured,
        responses: {
          '200': {
            description: 'All financial years, newest first.',
            content: { 'application/json': { schema: list('FinancialYear') } },
          },
          ...commonErrors,
        },
      },
      post: {
        tags: ['Administration'],
        summary: 'Create a financial year (admin only)',
        security: secured,
        requestBody: requestBody('FinancialYearInput'),
        responses: {
          '201': jsonResponse('Created financial year', 'FinancialYear'),
          ...commonErrors,
        },
      },
    },
    '/admin/financial-years/{id}': {
      patch: {
        tags: ['Administration'],
        summary: 'Update a financial year (admin only)',
        security: secured,
        parameters: [pathId('id', 'Financial year ID')],
        requestBody: requestBody('FinancialYearPatchInput'),
        responses: {
          '200': jsonResponse('Updated financial year', 'FinancialYear'),
          ...commonErrors,
        },
      },
    },
  },
};

export default openapi;
