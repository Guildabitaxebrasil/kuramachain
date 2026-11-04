/**
 * Seletores de função e tópicos de evento do DeFi da Kurama.
 *
 * GERADO com `keccak256` (eth_utils) a partir das assinaturas em
 * `evm/contracts/*.sol` — não editar à mão. Para regenerar, rode o snippet:
 *
 *   python -c "from eth_utils import keccak; print(keccak(text='balanceOf(address)').hex()[:8])"
 *
 * (4 bytes para funções; o hash completo para tópicos de evento).
 */

export const FN = {
  // ERC-20 / LP
  name: '0x06fdde03', // name()
  symbol: '0x95d89b41', // symbol()
  decimals: '0x313ce567', // decimals()
  totalSupply: '0x18160ddd', // totalSupply()
  balanceOf: '0x70a08231', // balanceOf(address)
  allowance: '0xdd62ed3e', // allowance(address,address)
  approve: '0x095ea7b3', // approve(address,uint256)
  transfer: '0xa9059cbb', // transfer(address,uint256)

  // Factory / Pair / Router
  getPair: '0xe6a43905', // getPair(address,address)
  allPairsLength: '0x574f2ba3', // allPairsLength()
  allPairs: '0x1e3dd18b', // allPairs(uint256)
  getReserves: '0x0902f1ac', // getReserves()
  token0: '0x0dfe1681', // token0()
  token1: '0xd21220a7', // token1()
  burn: '0x89afcb44', // burn(address)
  price0CumulativeLast: '0x5909c0d5', // price0CumulativeLast()
  price1CumulativeLast: '0x5a3d5493', // price1CumulativeLast()
  factory: '0xc45a0155', // factory()
  pairFor: '0x96ed28f9', // pairFor(address,address)
  addLiquidity: '0x4b2fc7bb', // addLiquidity(address,address,uint256,uint256,address)
  swapExactTokensForTokens: '0x472b43f3', // swapExactTokensForTokens(uint256,uint256,address[],address)

  // Feed / Oráculo
  latestRoundData: '0xfeaf968c', // latestRoundData()
  description: '0x7284e416', // description()
  latestAnswer: '0x50d25bcd', // latestAnswer()
  latestTimestamp: '0x8205bf6a', // latestTimestamp()
  quorum: '0x1703a018', // quorum()
  reportersLength: '0x71eb16d0', // reportersLength()
  reporters: '0x5e02cb7d', // reporters(uint256)
  isReporter: '0x044ad7be', // isReporter(address)
  getPrice: '0x98d5fdca', // getPrice()
  feedPrice: '0xa04eecae', // feedPrice()
  consult: '0x3ddac953', // consult(address,uint256)
  update: '0xa2e62045', // update()
  period: '0xef78d4fd', // period()
  maxAge: '0x687043c5', // maxAge()
  twapReady: '0x444486b2', // twapReady()
  getAssetPrice: '0xb3596f07', // getAssetPrice(address)
  assetPriceInfo: '0xeb8708ff', // assetPriceInfo(address)

  // Lending
  getReservesList: '0xd1946dbc', // getReservesList()
  getReservesCount: '0x72218d04', // getReservesCount()
  getReserveConfigurationData: '0x3e150141', // getReserveConfigurationData(address)
  getReserveData: '0x35ea6a75', // getReserveData(address)
  getUserAccountData: '0xbf92857c', // getUserAccountData(address)
  getUserReserveData: '0x28dd2d01', // getUserReserveData(address,address)
  borrowRate: '0x08c728e1', // borrowRate(address)
  utilization: '0xbf20d9dc', // utilization(address)
  deposit: '0xf45346dc', // deposit(address,uint256,address)
  withdrawLending: '0x69328dec', // withdraw(address,uint256,address)
  borrow: '0x6c665a55', // borrow(address,uint256,address)
  repay: '0x5ceae9c4', // repay(address,uint256,address)
  priceOracle: '0x2630c12f', // priceOracle()
  closeFactor: '0x05308b9f', // closeFactor()
  initReserve: '0x81b11a08', // initReserve(address,uint16,uint16,uint16,uint16)

  // Staking
  poolCount: '0xf525cb68', // poolCount()
  poolInfo: '0x1526fe27', // poolInfo(uint256)
  userInfo: '0x93f1a40b', // userInfo(uint256,address)
  pendingReward: '0x98969e82', // pendingReward(uint256,address)
  stake: '0x7b0472f0', // stake(uint256,uint256)
  withdrawStake: '0x441a3e70', // withdraw(uint256,uint256)
  claim: '0x379607f5', // claim(uint256)
  emergencyWithdraw: '0x5312ea8e', // emergencyWithdraw(uint256)

  // Bridge
  localChainId: '0x5b056da5', // localChainId()
  threshold: '0x42cde4e8', // threshold()
  paused: '0x5c975abb', // paused()
  nonce: '0xaffed0e0', // nonce()
  depositBridge: '0x8b6099db', // deposit(address,uint256,uint256,address)
  wrappedFor: '0xcac887fc', // wrappedFor(uint256,address)
  isValidator: '0xfacd743b', // isValidator(address)
  validatorsLength: '0xf1105a7e', // validatorsLength()
} as const;

/** Uniswap V3 — conferido em `api/uniswap.ts` (deployments oficiais). */
export const UNIV3 = {
  /** UniswapV3Factory.getPool(address,address,uint24) */
  getPool: '0x1698ee82',
  /** UniswapV3Pool.slot0() → (sqrtPriceX96, tick, ...) */
  slot0: '0x3850c7bd',
  /** UniswapV3Pool.liquidity() */
  liquidity: '0x1a686502',
  /** QuoterV2.quoteExactInputSingle((address,address,uint256,uint24,uint160)) */
  quoteExactInputSingle: '0xc6a5026a',
} as const;

export const EVT = {
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  Approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  PairCreated: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
  Mint: '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f',
  Burn: '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496',
  Sync: '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1',
  PairSwap: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
  SwapExecuted: '0x764f0dc063c06f32d89a3f3af80c0db4be8a090901f589a478b447e0a51f09f1',
  LiquidityAdded: '0x36f3b2e1a21c19137dd82ec243b0708a1d26b3d1fa1dc49c44c4c366a5878138',
  BridgeDeposit: '0xa4c357631fb118ffc746dece91eb6870585dda4f63c09a2a43bf09ea9014cf39',
  Staked: '0x18dcd430020e4d4899772fd94a8b40451dc5044dfb70bc46b532eeae431c864f',
  Withdrawn: '0xcf7d23a3cbe4e8b36ff82fd1b05b1b17373dc7804b4ebbd6e2356716ef202372',
  RewardPaid: '0x04492fab062412e7e4e5f46c9e919f1640652946a5e163ad6e6c1c03d87954d2',
  LendingDeposit: '0x7cfff908a4b583f36430b25d75964c458d8ede8a99bd61be750e97ee1b2f3a96',
  LendingBorrow: '0xc1561b330e73faa7d5d1ac03c968d8f359b0191ccdb9cc002cf7d8eb6ae038cb',
  LendingRepay: '0x4cdde6e09bb755c9a5589ebaec640bbfedff1362d4b255ebf8339782b9942faa',
} as const;
