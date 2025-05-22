const calculatePosition = () => {
  const RISK = 120;
  const MARGIN = 200;

  const entry = 102500;
  const stopLost = 104500;

  const stopLostPercent = Math.abs(entry - stopLost) / entry;
  const positionValue = RISK / stopLostPercent;
  const leverage = positionValue / MARGIN;

  console.log(`Entry: ${entry}`);
  console.log(`Stop Lost: ${stopLost}`);
  console.log(`Stop Lost Percent: ${stopLostPercent}`);
  console.log(`Position Value: ${positionValue}`);
  console.log(`Leverage: ${leverage}`);
  console.log(`Risk: ${RISK}`);
  console.log(`Margin: ${MARGIN}`);
};
