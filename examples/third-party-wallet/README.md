# Minimal third-party wallet integration

This example imports REWIND's TypeScript SDK **without** importing the REWIND React website or using the built-in wallet connector.

A wallet author passes their existing wallet signer to `sendViaRewind`. The wallet keeps all signing keys and decides how to display the transaction and warnings. The SDK only prepares standard NEAR FunctionCall parameters.

```ts
const result = await sendViaRewind({
  wallet: myExistingWalletAdapter,
  contractId: 'YOUR_FIXED_60S_CONTRACT.testnet',
  network: 'testnet',
  recipient: 'winner.testnet',
  amountNear: '1',
  contacts: myWalletSavedContacts,
  confirmReview: async (review, amount) => {
    // Display amount, actual recipient and contextual warnings here.
    // Return true only after the user approves.
    return showMyWalletConfirmation(review, amount);
  },
});
```

For Wallet Selector adapters, call the wallet's signAndSendTransaction with receiverId = REWIND's contract and an action built from the SDK's methodName, args, gas and deposit; **never** sign a direct Transfer action to the recipient when using protected mode.

The SDK deliberately never claims it is already integrated in any named third-party wallet. Integration requires the wallet developer to adopt it.
