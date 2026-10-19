// Existing fixtures use Chinese intents. Keep their baseline independent of the
// developer's shell; locale tests explicitly select and restore other languages.
process.env.PI_MINDFOLD_LANG = "zh-CN";
