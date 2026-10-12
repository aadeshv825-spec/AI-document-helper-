export interface SampleDoc {
  id: string;
  title: string;
  category: string;
  preview: string;
  text: string;
}

export const SAMPLE_DOCUMENTS: SampleDoc[] = [
  {
    id: 'rental-agreement',
    title: 'Standard Residential Rental Agreement',
    category: 'Legal',
    preview: 'This Residential Lease Agreement is entered into on this 1st day of October...',
    text: `RESIDENTIAL LEASE AGREEMENT

This Agreement is made on this 1st day of October, 2026, between Rajesh Kumar ("Landlord") and Priya Sharma ("Tenant") for the leased premises located at Flat 402, Greenfield Heights, Sector 62, Noida, Uttar Pradesh 201309.

1. TERM OF LEASE: The term of this lease begins on November 1, 2026, and expires on October 31, 2027.
2. MONTHLY RENT: The Tenant agrees to pay a monthly rent of INR 28,000 on or before the 5th day of each calendar month.
3. SECURITY DEPOSIT: The Tenant has deposited INR 56,000 as a refundable security deposit.
4. UTILITIES: The Tenant shall be responsible for electricity, water, and internet utility bills incurred during occupancy.
5. MAINTENANCE & REPAIRS: Minor repairs under INR 1,500 shall be borne by the Tenant. Major structural repairs remain the responsibility of the Landlord.
6. TERMINATION & NOTICE: Either party may terminate this agreement by providing a 30-day written notice.

Landlord Signature: Rajesh Kumar
Tenant Signature: Priya Sharma`,
  },
  {
    id: 'medical-prescription',
    title: 'Clinical Consultation & Prescription',
    category: 'Medical',
    preview: 'Patient: Amit Verma, Age: 34, Diagnosis: Acute Pharyngitis...',
    text: `METRO MULTISPECIALTY HOSPITAL
DEPARTMENT OF GENERAL MEDICINE

Date: 04 October 2026
Patient Name: Amit Verma
Age / Gender: 34 / Male
Consultant: Dr. Neha Saxena, MD (Internal Medicine)

CLINICAL NOTES:
Patient presented with complaints of sore throat, mild dry cough, and low-grade fever for 3 days. Vital signs stable. Throat examination reveals mild erythema without exudates. Lungs clear to auscultation bilaterally.

DIAGNOSIS:
Acute Viral Pharyngitis with upper respiratory tract symptoms.

Rx / MEDICATIONS:
1. Tab. Paracetamol 650mg — 1 tablet SOS after meals for fever / body ache.
2. Tab. Levocetirizine 5mg — 1 tablet at bedtime for 5 days.
3. Warm saline gargles 3 times daily.
4. Adequate hydration and vocal rest.

FOLLOW-UP:
Review after 5 days if symptoms do not improve or if high fever develops.`,
  },
  {
    id: 'invoice-bill',
    title: 'Tax Invoice & Services Statement',
    category: 'Finance',
    preview: 'Tax Invoice INV-2026-1049, TechServe Solutions Pvt Ltd...',
    text: `TECHSERVE SOLUTIONS PRIVATE LIMITED
CIN: U72200DL2021PTC384729
GSTIN: 07AABCT3928Q1Z4
Address: 12th Floor, Cyber Tower, Gurugram, Haryana 122002

TAX INVOICE: INV-2026-1049
Invoice Date: October 3, 2026
Due Date: October 18, 2026

Billed To:
Apex Logistics & Supply Chain Pvt Ltd
GSTIN: 07AABCA1294F1Z8

LINE ITEMS:
1. Cloud Infrastructure Management (Monthly retainer - Sept 2026): INR 45,000.00
2. Automated Backup & Disaster Recovery Setup: INR 18,000.00
3. SSL Certificate & Domain Renewal: INR 4,500.00

Subtotal: INR 67,500.00
CGST (9%): INR 6,075.00
SGST (9%): INR 6,075.00
TOTAL AMOUNT PAYABLE: INR 79,650.00

Bank Details:
HDFC Bank, Current A/C: 50200049281923, IFSC: HDFC0000429
Authorized Signatory: TechServe Solutions Pvt Ltd`,
  },
  {
    id: 'meeting-minutes',
    title: 'Quarterly Executive Review Minutes',
    category: 'Business',
    preview: 'Quarterly Business Review Q3 2026, Attendees: Leadership Team...',
    text: `QUARTERLY BUSINESS REVIEW MINUTES — Q3 2026
Date: October 2, 2026 | Time: 10:00 AM - 12:30 PM IST
Location: Main Conference Room & Virtual Meet

ATTENDEES:
- Vikram Malhotra (CEO)
- Sunita Rao (CTO)
- Rohan Deshmukh (Head of Product)
- Kavita Patel (VP Marketing)

AGENDA TOPICS:
1. Performance Metrics & User Acquisition in Q3.
2. AI Document Processing latency optimization.
3. Android App Store release and Play Billing V2 rollout.
4. Security & Compliance audit milestones.

KEY DECISIONS:
- Engineering team reduced OCR processing latency from 4.2s to 1.8s using Gemini Flash pipeline.
- Production Google Play release version locked to versionCode 8 (v1.0.1).
- Offline fallback and local storage synchronization approved for full deployment.
- Pro subscription pricing set to ₹99/month and ₹699/year.

ACTION ITEMS:
- Sunita: Finalize Google Play Pub/Sub RTDN verification endpoints by Oct 6.
- Rohan: Complete end-to-end integration tests for document extraction by Oct 8.`,
  },
];

// Clean 100x100 white sample document image with subtle document border and text lines
export const SAMPLE_DOCUMENT_PHOTO_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABTSURBVHhe7cExAQAAAMKg9U9tCF8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAODVAM4/AAFB7sXSAAAAAElFTkSuQmCC';
