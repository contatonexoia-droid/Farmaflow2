import { checkProductMatchesRule } from "./types.js";

// Mock the rule and products based on DB output
const rule = {
  "id": "promo_1784607589511",
  "tenantId": "farmaciatrevo",
  "name": "Kit Babymed",
  "type": "BUNDLE_FIXED_PRICE",
  "targetType": "BUNDLE_SLOTS",
  "targetValue": "SELEÇÃO MANUAL",
  "buyX": 3,
  "payY": 2,
  "discountThresholds": [],
  "comboProducts": [],
  "comboDiscountPercentage": null,
  "specificProductIds": [],
  "startDate": "2026-07-21T03:00:00+00:00",
  "endDate": "2026-07-28T03:00:00+00:00",
  "isActive": true,
  "filtersMetadata": {
    "search": "",
    "category": [],
    "maxPrice": "",
    "minPrice": "",
    "minStock": "",
    "bundlePrice": 15.99,
    "bundleSlots": [
      [
        "mthu9ajj1"
      ],
      [
        "5rdtu4rbi"
      ]
    ],
    "manufacturer": [],
    "highlightIcon": "Percent",
    "highlightColor": "blue",
    "highlightInCategoriesBar": true
  },
  "bundlePrice": 15.99,
  "bundleSlots": [
    [
      "mthu9ajj1"
    ],
    [
      "5rdtu4rbi"
    ]
  ],
  "scope": "SINGLE_STORE"
};

const product1 = {
  "id": "5rdtu4rbi",
  "name": "TOALHAS UMED BABYLIMP C/100 UN",
  "barcode": "7908174101468",
  "tenant_id": "farmaciatrevo"
};

const product2 = {
  "id": "mthu9ajj1",
  "name": "BABYMED MENINA POM 45G",
  "barcode": "7896523208985",
  "tenant_id": "farmaciatrevo"
};

const tenantId = "farmaciatrevo";
const matrizProducts = [];

console.log("Product 1 match:", checkProductMatchesRule(rule, product1, matrizProducts, tenantId));
console.log("Product 2 match:", checkProductMatchesRule(rule, product2, matrizProducts, tenantId));
