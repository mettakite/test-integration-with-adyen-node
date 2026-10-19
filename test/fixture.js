// Adyen's worked example from the "Verify HMAC signatures" page (standard webhooks).
export const DOC_KEY = "44782DEF547AAA06C910C43932B1EB0C71FC68D9D0C057550C48EC2ACF6BA056";
export const DOC_ITEM = {
  pspReference: "7914073381342284",
  originalReference: "",
  merchantAccountCode: "TestMerchant",
  merchantReference: "TestPayment-1407325143704",
  amount: { value: 1130, currency: "EUR" },
  eventCode: "AUTHORISATION",
  success: "true",
  additionalData: { hmacSignature: "coqCmt/IZ4E3CzPvMY8zTjQVL5hYJUiBRg8UU+iCWo0=" },
};
