# Easy Tender

Easy Tender is the EasyFile tender, RFQ and RFP submission workspace.

It accepts text-based PDF, DOCX, TXT, Markdown, CSV, JSON and HTML source documents and turns the extracted content into a tender workspace with metadata, a compliance matrix, evidence tracking, an action plan, clarification questions, risk flags, readiness KPIs, CSV export, print output and JSON backup/restore.

The first release is local-first. Workspace state is stored in browser localStorage under easy.tender.workspace.v1. PDF extraction uses PDF.js and DOCX extraction uses Mammoth in the browser. No API key is embedded in the page.

Image-only/scanned PDFs require OCR before analysis. The built-in analyser is heuristic and evidence-led; users must verify every requirement against the original tender before submission.

Recommended next integrations are Easy Capture for OCR, Easy List for assigned tender tasks and dependencies, Easy CRM for issuer/contact records, Easy Quote for commercial schedules, Easy Save for evidence repositories, and a same-origin AI service for citation-aware clause analysis and response drafting.