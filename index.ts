import TelegramBot from "node-telegram-bot-api";
import { RestClient } from "okx-api";
import dbHandler from "./storage";

const stopLossPercentWithMargin = 0.6;

const okxClient = new RestClient({
  apiKey: process.env.OKX_API_KEY as string,
  apiSecret: process.env.OKX_SECRET_KEY as string,
  apiPass: process.env.OKX_PASSPHRASE as string,
});

const signalMessage = (
  pos: string,
  ticker: string,
  leverage: string,
  signalNumber: number,
  entry: string[],
  stopLost: string[],
  tp: string[]
) => `
<b>${pos} $${ticker.toUpperCase()} ${leverage}x 1R [#${signalNumber}] [Bot-drift-trend]</b>

<b>Entry</b>: ${entry.join(" - ")}
<b>SL</b>: ${stopLost.join(" - ")}
<b>TP</b>: ${tp.join(" - ")}
`;

function formatNumber(num: number, maxSig = 3): string {
  const s = num.toString();
  if (!s.includes(".")) return s; // no decimal point → integer
  const [intPart, fracPart] = s.split(".");
  if (!fracPart || fracPart.length <= maxSig) return s; // no need to format
  // if the fraction is all zeros, just return the integer
  if (/^0+$/.test(fracPart)) return intPart as string;

  let sigCount = 0;
  let out = "";
  let gotNumbers = false;
  for (const c of fracPart) {
    if (c === "0" && sigCount === 0) {
      if (gotNumbers) {
        sigCount++;
      }
      if (sigCount >= maxSig) break;
      // leading zeros before the first non-zero
      out += c;
    } else if (c !== "0") {
      gotNumbers = true; // we have seen at least one non-zero digit
      // a non-zero digit
      sigCount++;
      out += c;
      if (sigCount >= maxSig) break;
    } else {
      if (gotNumbers) {
        sigCount++;
      }
      if (sigCount >= maxSig) break;
      // zeros after we've already started counting non-zero digits
      out += c;
    }
  }

  console.log("out: ", out);
  return intPart + "." + out;
}

const calculateLeverage = (entry: number, stopLost: number): number => {
  const stopLostPercent = Math.abs(entry - stopLost) / entry;
  return parseInt((stopLossPercentWithMargin / stopLostPercent).toFixed(2));
};

const calculateTakeProfit = (entry: number, stopLost: number): string[] => {
  const stopLostPercent = Math.abs(entry - stopLost) / entry;
  const tpPercent = [
    1 * stopLostPercent,
    1.5 * stopLostPercent,
    2 * stopLostPercent,
    2.3 * stopLostPercent,
    3 * stopLostPercent,
  ];

  const tp = tpPercent.map((tp) => {
    if (entry < stopLost) {
      tp = -tp;
    }
    const tpValue = entry + entry * tp;
    return formatNumber(tpValue, 3);
  });

  return tp;
};

const openOkxPosition = async (
  ticker: string,
  pos: string,
  leverage: number,
  et: string,
  sl: string,
  tp: string
): Promise<string> => {
  const margin = parseInt(process.env.MARGIN as string);
  await okxClient.setLeverage({
    instId: `${ticker}-USDT-SWAP`,
    lever: `${leverage}`,
    mgnMode: "cross",
  });

  const size = (
    await okxClient.getUnitConvert({
      instId: `${ticker}-USDT-SWAP`,
      sz: `${margin * leverage}`,
      opType: "open",
      unit: "usds",
      px: `${et}`,
    })
  )[0];

  await okxClient.submitOrder({
    instId: `${ticker.toUpperCase()}-USDT-SWAP`,
    tdMode: "cross",
    side: pos.toLocaleLowerCase() == "long" ? "buy" : "sell",
    posSide: "net",
    ordType: "market",
    slTriggerPx: sl,
    tpTriggerPx: tp,
    slOrdPx: sl,
    tpOrdPx: tp,
    sz: size?.sz as string,
  });
  return `Opening position: ${pos} ${ticker} ${leverage}x, size: ${size?.sz}, entry: ${et}, sl: ${sl}, tp: ${tp}`;
};

const main = async () => {
  console.log("Start bot...");
  await dbHandler.open();
  const bot = new TelegramBot(process.env.BOT_TOKEN as string);

  let signalNumber = 0;
  try {
    signalNumber = await dbHandler.get("signalNumber");
  } catch (error) {
    await dbHandler.set("signalNumber", 0);
  }

  bot.on("message", async (msg) => {
    if (msg.from?.id != parseInt(process.env.ADMIN_ID as string)) {
      return;
    }
    try {
      const commands = msg.text?.split("-") || msg.caption?.split("-");

      if (!commands) {
        bot.sendMessage(msg.chat.id, "Invalid command");
        return;
      }

      const entry = commands[2] as string;
      const stopLost = commands[3] as string;
      const leverage = calculateLeverage(
        parseFloat(entry.split(",")[0] as string),
        parseFloat(stopLost.split(",")[0] as string)
      );

      const entrySplit = entry.split(",").map((e) => e.trim());
      const stopLostSplit = stopLost.split(",").map((sl) => sl.trim());
      const tpSplit = calculateTakeProfit(
        parseFloat(entrySplit[0] as string),
        parseFloat(stopLostSplit[0] as string)
      );

      const pos = commands[0]?.trim() || "";
      const ticker = commands[1]?.trim() || "";

      if (parseInt(process.env.SUBMIT_ORDER as string) == 1) {
        try {
          const message = await openOkxPosition(
            ticker,
            pos,
            leverage,
            entrySplit[0] as string,
            stopLostSplit[0] as string,
            tpSplit[tpSplit.length - 2] as string
          );
          await bot.sendMessage(process.env.IMDUCHUYYY_ID as string, message);
        } catch (error) {
          console.log("Error: ", error);
          await bot.sendMessage(
            process.env.IMDUCHUYYY_ID as string,
            "Fail to submitting order"
          );
          return;
        }
      }

      if (msg.photo && msg.photo.length > 0) {
        const fileId = msg.photo[0]?.file_id as any;
        await bot.sendPhoto(process.env.TARGET_CHANNEL_ID as string, fileId, {
          caption: signalMessage(
            pos,
            ticker,
            leverage.toString(),
            signalNumber,
            entrySplit,
            stopLostSplit,
            tpSplit
          ),
          parse_mode: "HTML",
        });
        return;
      }
      await bot.sendMessage(
        process.env.TARGET_CHANNEL_ID as string,
        signalMessage(
          pos,
          ticker,
          leverage.toString(),
          signalNumber,
          entrySplit,
          stopLostSplit,
          tpSplit
        ),
        {
          parse_mode: "HTML",
        }
      );

      signalNumber++;
      await dbHandler.set("signalNumber", signalNumber);
    } catch (error) {
      console.log("Error: ", error);
      await bot.sendMessage(msg.chat.id, "Invalid command");
    }
  });

  await bot.startPolling();
};

main();
