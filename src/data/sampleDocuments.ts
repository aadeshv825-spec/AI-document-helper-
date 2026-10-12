export interface SampleDoc {
  id: string;
  title: string;
  category: string;
  preview: string;
  text: string;
}

export const SAMPLE_DOCUMENTS: SampleDoc[] = [
  {
    id: 'sample-1',
    title: 'Invoice #INV-2024-001',
    category: 'Invoices & Bills',
    preview: 'ABC Corp - Services rendered Jan 2024',
    text: `INVOICE

Invoice Number: INV-2024-001
Date: January 15, 2024
Due Date: February 14, 2024

From:
ABC Corporation
123 Business Ave
San Francisco, CA 94102
EIN: 12-3456789

To:
XYZ Client LLC
456 Client Street
New York, NY 10001

Description of Services:
- Consulting Services (Jan 1-15, 2024): $5,000.00
- Technical Review: $2,500.00
- Project Management: $3,000.00

Subtotal: $10,500.00
Tax (8.5%): $892.50
Total: $11,392.50

Payment Terms: Net 30
Please remit payment to:
ABC Corporation
Bank: First National Bank
Routing: 021000021
Account: 9876543210

Thank you for your business!`,
  },
  {
    id: 'sample-2',
    title: 'Lease Agreement - 742 Maple Drive',
    category: 'Contracts & Legal',
    preview: 'Residential lease 12-month term',
    text: `RESIDENTIAL LEASE AGREEMENT

This Lease Agreement ("Agreement") is made on March 1, 2024, between:

LANDLORD: Jane Smith ("Landlord")
Address: 100 Oak Lane, Springfield, IL 62701

TENANT: John Doe ("Tenant")
Address: 742 Maple Drive, Springfield, IL 62704

PROPERTY: 742 Maple Drive, Springfield, IL 62704
A 2-bedroom, 1-bathroom single-family residence

TERM: 12 months, commencing April 1, 2024, ending March 31, 2025

RENT: $1,850.00 per month, due on the 1st of each month
Security Deposit: $1,850.00 (refundable)
Pet Deposit: $300.00 (non-refundable for cat)

UTILITIES: Tenant responsible for electricity, gas, water, internet
Landlord responsible for trash collection

MAINTENANCE: Landlord responsible for structural repairs, HVAC, plumbing
Tenant responsible for minor repairs under $100, lawn care

TERMINATION: 60-day written notice required
Early termination fee: 2 months' rent

GOVERNING LAW: State of Illinois
Landlord Signature: _________________ Date: _______
Tenant Signature: _________________ Date: _______`,
  },
  {
    id: 'sample-3',
    title: 'Meeting Notes - Q1 Planning',
    category: 'Notes & Summaries',
    preview: 'Team sync on quarterly objectives',
    text: `MEETING NOTES - Q1 PLANNING SESSION
Date: January 8, 2024
Time: 10:00 AM - 11:30 AM
Attendees: Sarah (PM), Mike (Dev), Lisa (Design), Tom (QA)

AGENDA:
1. Review Q4 accomplishments
2. Set Q1 objectives and key results
3. Resource allocation
4. Risk assessment

KEY DECISIONS:
- Launch v2.0 by March 15, 2024
- Hire 2 additional backend engineers by February
- Allocate 20% sprint capacity to tech debt
- Implement automated regression testing

ACTION ITEMS:
- Sarah: Finalize Q1 roadmap by Jan 12
- Mike: Set up CI/CD for new microservice by Jan 19
- Lisa: Complete design system audit by Jan 26
- Tom: Define test coverage targets by Jan 15

RISKS:
- Dependency on third-party API (mitigation: build abstraction layer)
- Team capacity during holiday season (mitigation: adjust sprint velocity)

NEXT MEETING: January 22, 2024 at 10:00 AM`,
  },
  {
    id: 'sample-4',
    title: 'Medical Report - Patient #88472',
    category: 'General',
    preview: 'Annual physical examination results',
    text: `CONFIDENTIAL MEDICAL REPORT

Patient: Robert Johnson
DOB: 05/12/1978
Patient ID: 88472
Date of Exam: February 20, 2024
Provider: Dr. Amanda Chen, MD

VITAL SIGNS:
Blood Pressure: 128/82 mmHg
Heart Rate: 72 bpm
Temperature: 98.6°F
Respiratory Rate: 16/min
BMI: 24.3

LABORATORY RESULTS:
- CBC: Within normal limits
- CMP: Glucose 95 mg/dL, Creatinine 0.9 mg/dL
- Lipid Panel: Total Cholesterol 185, HDL 52, LDL 110, Triglycerides 115
- HbA1c: 5.4%
- TSH: 2.1 mIU/L

ASSESSMENT:
Patient is in good overall health. Blood pressure slightly elevated - recommend lifestyle modifications (reduce sodium, increase exercise). Lipid profile within acceptable range. No acute concerns identified.

RECOMMENDATIONS:
1. Annual physical in 12 months
2. Colonoscopy screening (due at age 45)
3. Continue current medications
4. Follow-up in 6 months for BP monitoring

Provider Signature: _________________ Date: 02/20/2024`,
  },
  {
    id: 'sample-5',
    title: 'Software Requirements Spec v3.2',
    category: 'General',
    preview: 'Technical specification for API gateway',
    text: `SOFTWARE REQUIREMENTS SPECIFICATION
Version: 3.2
Project: API Gateway Modernization
Document ID: SRS-API-2024-001
Date: February 1, 2024
Author: Architecture Team

1. INTRODUCTION
This document specifies the requirements for the modernization of the legacy API Gateway to support microservices architecture.

2. FUNCTIONAL REQUIREMENTS
FR-001: The gateway SHALL route requests based on path-based routing rules
FR-002: The gateway SHALL support JWT validation with JWKS endpoint
FR-003: The gateway SHALL implement rate limiting (1000 req/min per client)
FR-004: The gateway SHALL provide request/response transformation
FR-005: The gateway SHALL support gRPC to REST transcoding

3. NON-FUNCTIONAL REQUIREMENTS
NFR-001: Latency p99 < 50ms for routing decisions
NFR-002: Availability 99.99% (multi-AZ deployment)
NFR-003: Horizontal scaling to 1000 RPS
NFR-004: TLS 1.3 termination at edge

4. TECHNOLOGY STACK
- Runtime: Go 1.22 / Node.js 20
- Proxy: Envoy / Kong Gateway
- Config: Consul / etcd
- Monitoring: Prometheus + Grafana

5. ACCEPTANCE CRITERIA
- All FRs verified in integration tests
- Load test passes at 150% expected peak
- Chaos engineering validation complete`,
  },
];

export const SAMPLE_DOCUMENT_PHOTO_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';