// Scanner universe: large US stocks by sector, plus reference ETFs.
// ETFs are scanned but excluded from breadth and sector statistics.

const S = (sector, list) => list.split(' ').map((symbol) => ({ symbol, sector }));

export const STOCKS = [
  ...S('Technology', 'AAPL MSFT NVDA AVGO ORCL CRM ADBE AMD CSCO ACN IBM INTC QCOM TXN AMAT MU INTU NOW PLTR ANET LRCX KLAC ADI PANW CRWD'),
  ...S('Communication', 'GOOGL META NFLX DIS CMCSA T VZ TMUS'),
  ...S('Consumer Discretionary', 'AMZN TSLA HD MCD NKE LOW SBUX BKNG TJX GM F'),
  ...S('Consumer Staples', 'WMT COST PG KO PEP PM MO MDLZ CL TGT'),
  ...S('Healthcare', 'LLY UNH JNJ ABBV MRK PFE TMO ABT DHR AMGN GILD BMY CVS MDT ISRG'),
  ...S('Financials', 'BRK-B JPM V MA BAC WFC GS MS C AXP BLK SCHW SPGI COF PYPL USB MET AIG'),
  ...S('Industrials', 'GE CAT RTX HON UNP BA LMT DE UPS GD MMM FDX EMR'),
  ...S('Energy', 'XOM CVX COP SLB EOG'),
  ...S('Utilities', 'NEE DUK SO'),
  ...S('Materials', 'LIN DOW'),
  ...S('Real Estate', 'AMT PLD SPG'),
];

export const ETFS = S('ETF', 'SPY QQQ IWM DIA XLK XLF XLV XLE XLY XLP XLI XLU XLB XLRE XLC SMH GLD SLV TLT');

export const UNIVERSE = [...STOCKS, ...ETFS];
