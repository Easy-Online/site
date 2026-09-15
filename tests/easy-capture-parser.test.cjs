const assert = require("node:assert/strict");
const parser = require("../assets/js/easy-capture-parser.js");

function close(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
}

const amberfieldReceipt = `
AMBERFIELD S/S
WIERDA PARK
CENTURION 0157
Tel: 012-656-0821 Fax: 012-656-0822
VAT#: 4240195125
COPY COPY COPY COPY COPY COPY COPY COPY
TAX INVOICE
Terminal: Forecourt Shift#: 27272
Operator: Molefi Inv#:0694513
Date: 14.9.2026 23:08 Reg #:
Item sales Qty Amount
Pies All Sorts 1.000 31.80
VID Cappuccino Gran 1.000 47.00
Marlboro Gold box 2 1.000 79.50
Lion Matches - Box 1.000 1.50
Sub Total: 138.96
VAT: 20.84
Total: 159.80
Paid C/Card: 159.80
Change: 0.00
THANK YOU
FOR YOUR SUPPORT.
* Non vatable items
`;

const first = parser.parseReceiptText(amberfieldReceipt);
assert.equal(first.supplier, "AMBERFIELD S/S");
assert.equal(first.supplierVat, "4240195125");
assert.equal(first.number, "0694513");
assert.equal(first.date, "2026-09-14");
assert.equal(first.currency, "ZAR");
assert.equal(first.paymentMethod, "Card");
assert.equal(first.category, "Meals");
close(first.amountExcl, 138.96);
close(first.vatAmt, 20.84);
close(first.amountIncl, 159.80);
assert.equal(first.lineItems.length, 4);
assert.equal(first.lineItems[0].description, "Pies All Sorts");
close(first.lineItems[0].qty, 1);
close(first.lineItems[0].total, 31.80);
assert.ok(first.confidence >= 85, `Expected strong confidence, got ${first.confidence}`);

const vidaReceipt = `
Vida e Caffe Shell Amberfield
ROAST. EXTRACT. DRINK.
VAT No.C0003297330
*** TAKE - AWAY ***
Order Num : 180
Tax Inv No : 2688
Covers : 1
CASHIER : Night Shift
Table 100
14/ September/2026 23:07:29
1 Cappuccino Grande (V) R47.00
Total : R47.00
R6.13 VAT Inclusive
R40.87 Total Excl
`;

const second = parser.parseReceiptText(vidaReceipt);
assert.equal(second.supplier, "Vida e Caffe Shell Amberfield");
assert.equal(second.supplierVat, "C0003297330");
assert.equal(second.number, "2688");
assert.equal(second.date, "2026-09-14");
assert.equal(second.category, "Meals");
close(second.amountExcl, 40.87);
close(second.vatAmt, 6.13);
close(second.amountIncl, 47.00);
assert.equal(second.lineItems.length, 1);
assert.equal(second.lineItems[0].description, "Cappuccino Grande (V)");
close(second.lineItems[0].qty, 1);
close(second.lineItems[0].total, 47.00);
assert.ok(second.confidence >= 85, `Expected strong confidence, got ${second.confidence}`);

assert.equal(parser.parseDate("14 September 2026 23:07"), "2026-09-14");
assert.equal(parser.parseDate("14/09/2026"), "2026-09-14");
assert.equal(parser.parseNumber("R1 234,56"), 1234.56);
assert.ok(parser.qualityScore(amberfieldReceipt) >= 70);
assert.ok(parser.qualityScore(vidaReceipt) >= 70);

console.log("Easy Capture parser regression tests passed.");
