module.exports = {
  "extends": "lighthouse:default",
  "settings": {
    "onlyCategories": [
      "performance"
    ],
    "formFactor": "desktop",
    "throttlingMethod": "devtools",
    "screenEmulation": {
      "mobile": false,
      "width": 1350,
      "height": 940,
      "deviceScaleFactor": 1,
      "disabled": false
    },
    "pauseAfterLoadMs": 3000,
    "maxWaitForLoad": 45000,
    "disableStorageReset": false
  }
};
