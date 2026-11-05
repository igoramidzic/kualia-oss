import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { BenchmarkInfo, ComparisonSample, PlaidComparisonTransaction } from './comparison';
import type { CategoryInput } from './helpers';

/**
 * Fixed development benchmark, captured from this workspace on 2026-09-21.
 * Every source transaction was reviewed, non-deleted, a regular single-category expense
 * or refund, dated 2026-07-21 or earlier, and linked to an original Plaid import.
 * V2 excludes opaque Apple subscriptions and categories requiring personal purchase intent.
 * Replacement cases were chosen from merchant/statement evidence, not model predictions.
 * Expected labels are the saved expense category IDs; no model predictions were used.
 *
 * Keep the order stable: the first 20 cover 20 categories; all 50 cover 26 categories.
 * Inputs, answers, and all 50 category options are frozen, so later database edits cannot
 * silently change the benchmark. Deliberate replacements must increment the version.
 * Raw import IDs and review flags are provenance only and are never provider inputs.
 */
export const BENCHMARK_WORKSPACE_ID = 'mn77jrgkth21kt6tx3gwz3cjds8cp570' as Id<'workspace'>;
export const BENCHMARK_INFO: BenchmarkInfo = {
  id: 'reviewed-categorization-2026-09-21-v2',
  workspaceId: BENCHMARK_WORKSPACE_ID,
  capturedAt: '2026-09-21',
  cutoffDate: '2026-07-21',
  availableTransactions: 50,
};

const categories: CategoryInput[] = [
  {
    groupName: 'Day to Day',
    id: 'jh7dxmpt5ep72s7k9cygv03hh18cpd6n',
    name: '🎬 Fun Money',
  },
  {
    groupName: 'Day to Day',
    id: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
    name: '⛽ Gas',
  },
  {
    groupName: 'Day to Day',
    id: 'jh75ej95jnjf4ky087whj851q18cq27m',
    name: '🍔 Dining Out',
  },
  {
    groupName: 'Day to Day',
    id: 'jh76nyb66t5dpq3xbwvrxmazkd8cpacq',
    name: '🛒 Groceries',
  },
  {
    groupName: 'Day to Day',
    id: 'jh71p50jm73ka7z79yqxrf4frh8cpjgk',
    name: '🔮 Miscellaneous',
  },
  {
    groupName: 'Day to Day',
    id: 'jh73az3sky3qxjnn5wb8b1vk8s8cpn5p',
    name: '🎮 Unnecessary Wants',
  },
  {
    groupName: 'True Expenses',
    id: 'jh70r6ejrrfbd7mf26j487mwrn8cpcs0',
    name: '🔧 Auto Maintenance',
  },
  {
    groupName: 'True Expenses',
    id: 'jh7bg6zwy2ses2vb6np00q7zr98cp3k5',
    name: '👕 Clothes',
  },
  {
    groupName: 'True Expenses',
    id: 'jh75q4zq3bm1m08gxyp07jdwyh8cp9nh',
    name: '💪 Fitness Journey',
  },
  {
    groupName: 'True Expenses',
    id: 'jh7crdzbwz22q9sx38bmrk4fws8cqrz6',
    name: '🤑 Gifts',
  },
  {
    groupName: 'True Expenses',
    id: 'jh7a0zw54g2qn5hf9be26ykty98cpe6f',
    name: '💈 Haircut',
  },
  {
    groupName: 'True Expenses',
    id: 'jh764ymh37yn8r68r2s87knw4d8cq7g9',
    name: '🪴 Home Improvement',
  },
  {
    groupName: 'True Expenses',
    id: 'jh7crbyv4zsejwsx1aehn731jn8cqp7v',
    name: '📱 Kualia',
  },
  {
    groupName: 'True Expenses',
    id: 'jh7a2gb104w5hy1znt8mn5xq098cqrc2',
    name: '🅿 Parking/Tolls',
  },
  {
    groupName: 'Savings',
    id: 'jh72tpnre82db1tnadn64gm2td8cp690',
    name: '⚠️ Emergency Fund',
  },
  {
    groupName: 'Savings',
    id: 'jh7c6p693rp2evzacxa3a0mt4s8cpqeg',
    name: '🤲 Giving',
  },
  {
    groupName: 'Savings',
    id: 'jh7fczzeaqnfbxh58tp42w0ydd8cqpz2',
    name: '⛑️ Health',
  },
  {
    groupName: 'Savings',
    id: 'jh79p0ce1pc3ap6fbtynwnsrfx8cqbxa',
    name: '🏡 House Down Payment',
  },
  {
    groupName: 'Savings',
    id: 'jh77wgb2ry693m42dbfgvkm65d8cpaft',
    name: '💻 Macbook',
  },
  {
    groupName: 'Savings',
    id: 'jh73kpfgrde2p4zsd26cgnmd498cp5g3',
    name: '📱 New Phone',
  },
  {
    groupName: 'Savings',
    id: 'jh7fw8btp7ttgh6c2tn81stjqh8cpaap',
    name: '🏎️ Porsche 911',
  },
  {
    groupName: 'Savings',
    id: 'jh71f28t9vbzx8y5c9hecjsyvh8cpma8',
    name: '🏖 Vacation',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh74e66f02vmkr244ndaw8sar18cq2af',
    name: '🔒 1Password',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh742r10zbzde3w82y79j8herd8cpxc1',
    name: '📺 AppleTV',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh71c770873ec2pv6jgkck6zx58cp06h',
    name: '🧼 Car Wash',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh72kc1rhm5xydakzcaeywv79n8cpcqg',
    name: '⚡ Electric',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh7arfz6ebpekkbxajxwynmeks8cqfx1',
    name: '🏋 EoS Membership',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh77mbkqs7hcz0hbrzgesgvbc58cpscw',
    name: '🏡 Home Assistant Nabu',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh7fq4er3m3psre7jfwkt69f518cqmp0',
    name: '🏦 Roth IRA',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh77x727s8vyeqzdp4h1ywz6h18cpsam',
    name: '☁️ iCloud',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh73f8tt2091khj8v3n7b9v0es8cpbqj',
    name: '🍿 Netflix',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh79b3bw50hjk3r5n1m88xc5818cpwev',
    name: '🍿 Prime Video',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh79008xywy7g9gv9m2np1dkzn8cqy91',
    name: '🏠 Rent',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh79hkfnnry1jn44yj7fewgd2h8cpfm5',
    name: '🏠 Renter’s Insurance',
  },
  {
    groupName: 'Monthly Bills',
    id: 'jh79zcve6wpsr5e574vf6h53018cqr50',
    name: '🍿 YouTube Premium',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh73zzm9fp9nnj6yqc6dcdyjvn8cpnhc',
    name: '🛍️ Amazon Prime',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7807m38gq21pqzy6gqw1xr498cpyng',
    name: '💳 Amex CC fee',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh72jrj4vdm0rbgd0qw67535fx8cpbg2',
    name: '🚗 Auto Insurance',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7b9zpv1dm5hrgk1a5a0ynrax8cp1zg',
    name: '🚗 Car Registration',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7f2h7z0n2wsteg6s90wgskr98cqkjd',
    name: '💻 Domain',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh769pm9krm36rcpben7hrvyt58cprym',
    name: '🏋️‍♂️ EoS Fee',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7ba60mms6rqfhfyd9kycfew98cqkwh',
    name: '☁️ Google One',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7dddtq5jkm2zr16zva8vv3k18cqc3z',
    name: '📱 Jomo Plus',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7b3v5p8aykqzw46k7f8w7zzx8cpwan',
    name: '🔒 NordVPN',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh792rqn8h18jdx5mexrgnzzkx8cqaw8',
    name: '📞 Phone Bill',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7f8mt2083z7ym9n49j4z8hh98cqyrt',
    name: '🎮 PlayStation Plus',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh7567zvpak39cfdkx60v7cx518cqvk0',
    name: '🦷 Retainer',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh77vtd11enchr7v7tmr9q1d418cqw7z',
    name: '📅 TickTick',
  },
  {
    groupName: 'Non Monthly Bills',
    id: 'jh73vpvp0pfdw1bp6ghrcbc41n8cp8kp',
    name: '🛒 Walmart+',
  },
  {
    groupName: 'KeyBankjjj',
    id: 'jh7fsfqwt0dpmmj299pmge4vtd8dyncz',
    name: 'Hi',
  },
];

const cases: Array<{
  rawImportId: string;
  reviewStatusAtCapture: 'reviewed';
  transaction: Omit<PlaidComparisonTransaction, 'expectedCategoryId'> & { expectedCategoryId: string };
}> = [
  {
    rawImportId: 'm573p04ct947y2xekevwmbpy0d8cpkja',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17btmn2z4pyrmwsxy8s78px7x8cq28k',
      date: '2026-07-05',
      name: 'Publix',
      merchant_name: 'Publix',
      amount: 203.45,
      category: ['Shops', 'Supermarkets and Groceries'],
      expectedCategoryId: 'jh76nyb66t5dpq3xbwvrxmazkd8cpacq',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm575f0133h1z13b921txqdq1n98cqtnx',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1709b7hqyexcbdshg8q4feexh8cqj4f',
      date: '2026-03-17',
      name: 'DD *DOORDASH CAVA',
      merchant_name: 'Cava',
      amount: 46.9,
      category: ['Service', 'Food and Beverage'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANT',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm572s955vx7p247mftztspgn398cp168',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm174kapf9anv1v81df23ryv3zx8cq9jy',
      date: '2026-06-01',
      name: 'Shell',
      merchant_name: 'Shell',
      amount: 46.27,
      category: ['Travel', 'Gas Stations'],
      expectedCategoryId: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
      personal_finance_category: {
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_GAS',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm570g43fm7z3p232g7j7rba5dh8cq51j',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm177nwjn03g4gjz1amjmwke5gh8cpz2w',
      date: '2026-07-02',
      name: 'CanopyatCitrus',
      merchant_name: 'Canopy At Citrus',
      amount: 2331.34,
      category: ['Transfer', 'Debit'],
      expectedCategoryId: 'jh79008xywy7g9gv9m2np1dkzn8cqy91',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57b3gk6edw5wpe7xkceerq8th8cp5cz',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17cx6kahds599bmvzwaam44th8cptee',
      date: '2026-04-03',
      name: 'MINT MOBILE',
      merchant_name: 'Mint Mobile',
      amount: 386.37,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh792rqn8h18jdx5mexrgnzzkx8cqaw8',
      personal_finance_category: {
        primary: 'RENT_AND_UTILITIES',
        detailed: 'RENT_AND_UTILITIES_TELEPHONE',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm572m86qrbtpx9beyez1shektn8cq7d3',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17fp2n1an4e97927n7jakpeah8cp437',
      date: '2026-07-09',
      name: 'TECO/PEOPLE GAS',
      merchant_name: 'Teco People Gas',
      amount: 30.99,
      category: ['Travel', 'Gas Stations'],
      expectedCategoryId: 'jh72kc1rhm5xydakzcaeywv79n8cpcqg',
      personal_finance_category: {
        primary: 'RENT_AND_UTILITIES',
        detailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm570ep7jr1b09wn8a6s2t2qyg58cqj1g',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17448c8055exmcvaf2ejmnvps8cpq66',
      date: '2026-05-01',
      name: 'AssurantRenters.Com',
      merchant_name: null,
      amount: -21.2,
      category: ['Service'],
      expectedCategoryId: 'jh79hkfnnry1jn44yj7fewgd2h8cpfm5',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_INSURANCE',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57esh5dtekxth8z4kgyxegn7h8cp87n',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm173c60jpc53mfttdy4jd9m49h8cq3cq',
      date: '2026-07-20',
      name: 'LINKS CAR WASH',
      merchant_name: 'Links Car Wash',
      amount: 26.88,
      category: ['Service', 'Automotive', 'Car Wash and Detail'],
      expectedCategoryId: 'jh71c770873ec2pv6jgkck6zx58cp06h',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_AUTOMOTIVE',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm574vjkjsdyjyh5g1ecc4zdxp18cpkap',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm172w184xa7b4771av6nkftefx8cpvsy',
      date: '2026-07-07',
      name: 'Netflix',
      merchant_name: 'Netflix',
      amount: 30.62,
      category: ['Service', 'Subscription'],
      expectedCategoryId: 'jh73f8tt2091khj8v3n7b9v0es8cpbqj',
      personal_finance_category: {
        primary: 'ENTERTAINMENT',
        detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm57bmjv7b18qn4egt6hta0zwd18cpyh0',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17eh8z4fb8syp5w5avkfkfge58cqf7c',
      date: '2026-05-29',
      name: 'ABC*40084-EOS FITNESTAMPA',
      merchant_name: 'EOS Fitness',
      amount: 31.94,
      category: ['Recreation', 'Gyms and Fitness Centers'],
      expectedCategoryId: 'jh7arfz6ebpekkbxajxwynmeks8cqfx1',
      personal_finance_category: {
        primary: 'PERSONAL_CARE',
        detailed: 'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm5726djpxxfr5rn8vapja146y18cpea7',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17da283znnx8hjyw0eypj5rdh8cp7np',
      date: '2026-05-25',
      name: 'HOME ASSISTANT CLOUDSACRAMENTO',
      merchant_name: 'Home Assistant',
      amount: 6.5,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh77mbkqs7hcz0hbrzgesgvbc58cpscw',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm57fv2sz5c5ztperzrjcg7p4kd8cq709',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17588yea8m7hqy49zqz6nwt498cp9va',
      date: '2026-07-11',
      name: 'AplPay CVS PHARMACY',
      merchant_name: 'CVS',
      amount: 19.34,
      category: ['Shops', 'Pharmacies'],
      expectedCategoryId: 'jh7fczzeaqnfbxh58tp42w0ydd8cqpz2',
      personal_finance_category: {
        primary: 'MEDICAL',
        detailed: 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm572se8favhj9cgypbqmy1amed8cqsws',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1707yvx4dnaemywb9mbzrgxfn8cqs7h',
      date: '2026-07-05',
      name: 'SUNPASS*ACC21261884',
      merchant_name: 'Sunpass',
      amount: 20.0,
      category: ['Travel', 'Tolls and Fees'],
      expectedCategoryId: 'jh7a2gb104w5hy1znt8mn5xq098cqrc2',
      personal_finance_category: {
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_TOLLS',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm576yrfphfczeyba72x1z6bpwh8cp4jv',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1794kwkkfhyb4ffvqsbtnzagn8cqcqd',
      date: '2026-07-11',
      name: 'AplPay BARBERSHOPTAMPA',
      merchant_name: 'Barbershop',
      amount: 50.0,
      category: ['Service', 'Personal Care'],
      expectedCategoryId: 'jh7a0zw54g2qn5hf9be26ykty98cpe6f',
      personal_finance_category: {
        primary: 'PERSONAL_CARE',
        detailed: 'PERSONAL_CARE_HAIR_AND_BEAUTY',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm572gz5ahgbkry2nxzpgag2fah8cqj7n',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm172gq1v8mqrqa0vrshsbzzfm98cqp18',
      date: '2026-01-08',
      name: 'SP BYLT BASICS',
      merchant_name: 'BYLT Basics HQ',
      amount: 9.14,
      category: ['Shops', 'Supermarkets and Groceries'],
      expectedCategoryId: 'jh7bg6zwy2ses2vb6np00q7zr98cp3k5',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_CONSULTING_AND_LEGAL',
        confidence_level: 'MEDIUM',
      },
    },
  },
  {
    rawImportId: 'm5777vd2wjvfxahwavqjrcbr1d8cqbyq',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm175n9y7ajxfwc1gffjm2w950n8cpy8k',
      date: '2026-06-10',
      name: 'Boris Amidzic "Bday present"',
      merchant_name: 'Boris Amidzic Bday',
      amount: 100.0,
      category: ['Transfer', 'Third Party', 'Venmo'],
      expectedCategoryId: 'jh7crdzbwz22q9sx38bmrk4fws8cqrz6',
      personal_finance_category: {
        primary: 'TRANSFER_OUT',
        detailed: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm576yz4880a9pp1mhg1c1fbehs8cqzxd',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17946y7krma8d8bpshk1cb0rn8cphn0',
      date: '2026-06-27',
      name: 'WL *STEAM PURCHASE',
      merchant_name: 'Steam',
      amount: 39.99,
      category: ['Shops', 'Computers and Electronics', 'Video Games'],
      expectedCategoryId: 'jh73az3sky3qxjnn5wb8b1vk8s8cpn5p',
      personal_finance_category: {
        primary: 'ENTERTAINMENT',
        detailed: 'ENTERTAINMENT_VIDEO_GAMES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm57ah41amhece6mxkf45b210t18cp6p7',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1762phsnsb19wz07r63a7mwc18cq08d',
      date: '2026-04-14',
      name: 'Delta Air Lines',
      merchant_name: 'Delta Air Lines',
      amount: 499.4,
      category: ['Travel', 'Airlines and Aviation Services'],
      expectedCategoryId: 'jh71f28t9vbzx8y5c9hecjsyvh8cpma8',
      personal_finance_category: {
        primary: 'TRAVEL',
        detailed: 'TRAVEL_FLIGHTS',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm57a3h6bvcy56war4vks291nx18cpk5t',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17ec44pqa09hn3es9gt9x11d58cqxpf',
      date: '2026-03-18',
      name: 'Fandango',
      merchant_name: 'Fandango',
      amount: 42.98,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh7dxmpt5ep72s7k9cygv03hh18cpd6n',
      personal_finance_category: {
        primary: 'ENTERTAINMENT',
        detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm578j7w5sgqt2qn5rtbhsh85qn8cqnn3',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm173tmnt6hw89snnf38j74k2q58cpdp2',
      date: '2026-03-15',
      name: 'TAKE 5 #360 360',
      merchant_name: 'Take',
      amount: 127.89,
      category: ['Service', 'Automotive', 'Maintenance and Repair'],
      expectedCategoryId: 'jh70r6ejrrfbd7mf26j487mwrn8cpcs0',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_AUTOMOTIVE',
        confidence_level: 'MEDIUM',
      },
    },
  },
  {
    rawImportId: 'm571938dg7vy5r32njv5zsq1kh8cpy4q',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17cgr568b7e1r3cxty3pkqcr18cqwn7',
      date: '2026-03-10',
      name: 'KUALIA, INC.',
      merchant_name: 'Kualia Inc.',
      amount: 7.99,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh7crbyv4zsejwsx1aehn731jn8cqp7v',
      personal_finance_category: {
        primary: 'GENERAL_MERCHANDISE',
        detailed: 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57epns9wcj1advwvrzt0whd4x8cqhty',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17awc13dgy327dy0awygcqtsx8cpq48',
      date: '2026-05-30',
      name: 'GODADDY#4098608318',
      merchant_name: 'GoDaddy',
      amount: 13.19,
      category: ['Service'],
      expectedCategoryId: 'jh7f2h7z0n2wsteg6s90wgskr98cqkjd',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm5784jm79xrvymagzqa4ychvzs8cp25f',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm179zxqe4jc2hge3zcp9mc9p6s8cpmjz',
      date: '2026-03-16',
      name: 'IRS',
      merchant_name: 'Internal Revenue Service',
      amount: 139.0,
      category: ['Tax', 'Payment'],
      expectedCategoryId: 'jh71p50jm73ka7z79yqxrf4frh8cpjgk',
      personal_finance_category: {
        primary: 'GOVERNMENT_AND_NON_PROFIT',
        detailed: 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm57802f3hqw830rapwk10qn7kh8cq5rg',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1796bzg0hn8hre0wddwhp7eyn8cp4wc',
      date: '2026-05-01',
      name: 'Prime Video Channels',
      merchant_name: 'Amazon Prime Video',
      amount: 15.7,
      category: ['Service', 'Entertainment'],
      expectedCategoryId: 'jh79b3bw50hjk3r5n1m88xc5818cpwev',
      personal_finance_category: {
        primary: 'ENTERTAINMENT',
        detailed: 'ENTERTAINMENT_TV_AND_MOVIES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm571a4zg33f6f466q78mgs4ysh8cpx8t',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm172y60zq0tej3bm0rwpzq7wgn8cqm38',
      date: '2026-03-04',
      name: 'SP TRANSPARENT LABS',
      merchant_name: 'Transparent Labs',
      amount: 99.99,
      category: ['Service'],
      expectedCategoryId: 'jh75q4zq3bm1m08gxyp07jdwyh8cp9nh',
      personal_finance_category: {
        primary: 'MEDICAL',
        detailed: 'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57fsvrywwzxhtcb4grvn001en8cq2qt',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17ffa31tcr2e87m7sd2rswha18cpmwc',
      date: '2026-02-18',
      name: 'GOOGLE ONE G.CO/HELPPAY#',
      merchant_name: 'Google One',
      amount: 19.99,
      category: ['Shops', 'Digital Purchase'],
      expectedCategoryId: 'jh7ba60mms6rqfhfyd9kycfew98cqkwh',
      personal_finance_category: {
        primary: 'GENERAL_SERVICES',
        detailed: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm57b2m8zwq1fs744rfz1vgnra58cq5ra',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17bjp0bt0f22xp2q903t96qtx8cpxcf',
      date: '2026-06-02',
      name: 'Walmart',
      merchant_name: 'Walmart',
      amount: 123.87,
      category: ['Shops', 'Department Stores'],
      expectedCategoryId: 'jh76nyb66t5dpq3xbwvrxmazkd8cpacq',
      personal_finance_category: {
        primary: 'GENERAL_MERCHANDISE',
        detailed: 'GENERAL_MERCHANDISE_SUPERSTORES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm576x22tcqp05mkbjp3d906kr98cqvj9',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1769kjc82zmte8e5mr0ge17nh8cq2he',
      date: '2026-01-14',
      name: 'FACTOR75',
      merchant_name: 'Factor75',
      amount: 147.89,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh76nyb66t5dpq3xbwvrxmazkd8cpacq',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm575b9geacdanb1yswqq6b7cs58cpsnp',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm175mjk77hhfx2c83wvnfg8h9x8cq3wt',
      date: '2026-05-12',
      name: 'AplPay CULVERS',
      merchant_name: "Culver's",
      amount: 11.48,
      category: ['Food and Drink', 'Restaurants', 'Fast Food'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_FAST_FOOD',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm572zpqy5vv783e7m89yy8mash8cq6a5',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm174yrvnd8jket6zk9wxk4jcrd8cqjq6',
      date: '2026-07-13',
      name: 'DD *DOORDASH HICCUPSSAN FRANCISCO',
      merchant_name: null,
      amount: 29.84,
      category: ['Service', 'Food and Beverage'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANT',
        confidence_level: 'MEDIUM',
      },
    },
  },
  {
    rawImportId: 'm57ffjngankztwj3e5r99wgjqx8cp8fk',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm177gzx5qeyveet2dwspceywq98cpane',
      date: '2026-02-20',
      name: 'AplPay THORNTONS',
      merchant_name: 'Thorntons',
      amount: 34.82,
      category: ['Shops', 'Supermarkets and Groceries'],
      expectedCategoryId: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm5718ashsrjpzxsjxrzq75pdvd8cqrtb',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17dv0wqrtcpk21rvh3aa57qts8cpc07',
      date: '2026-07-08',
      name: 'PAY PARKING BY PHONESAINT PETERSB',
      merchant_name: 'Pay Parking By Phone',
      amount: 5.35,
      category: ['Travel', 'Parking'],
      expectedCategoryId: 'jh7a2gb104w5hy1znt8mn5xq098cqrc2',
      personal_finance_category: {
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_PARKING',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm5762gm20dwhaxxcge9b9zf3w98cpvpj',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm178j1eb3s89e6w5d1d8h6aafs8cqcph',
      date: '2026-05-07',
      name: 'AplPay PRIME ENDOCRITampa',
      merchant_name: 'Prime Endo',
      amount: 146.41,
      category: ['Healthcare', 'Healthcare Services'],
      expectedCategoryId: 'jh7fczzeaqnfbxh58tp42w0ydd8cqpz2',
      personal_finance_category: {
        primary: 'MEDICAL',
        detailed: 'MEDICAL_PRIMARY_CARE',
        confidence_level: 'MEDIUM',
      },
    },
  },
  {
    rawImportId: 'm57fxyftmerbh5hqhg8jzmh5jx8cpbdc',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1740kcyma38egxxag2fn19k518cp587',
      date: '2026-07-10',
      name: 'AplPay MYCHART ELECTTAMPA',
      merchant_name: 'Mychart Elect',
      amount: 83.28,
      category: ['Healthcare', 'Healthcare Services'],
      expectedCategoryId: 'jh7fczzeaqnfbxh58tp42w0ydd8cqpz2',
      personal_finance_category: {
        primary: 'MEDICAL',
        detailed: 'MEDICAL_OTHER_MEDICAL',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57d2r1bzrmwvfzz4qqaxg3zdd8cq0xy',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm172jwp7a0twcvh0xhqp14rnvn8cq176',
      date: '2026-04-03',
      name: 'AplPay SESAME CARE -MIAMI',
      merchant_name: 'Sesame Care',
      amount: 44.0,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh7fczzeaqnfbxh58tp42w0ydd8cqpz2',
      personal_finance_category: {
        primary: 'MEDICAL',
        detailed: 'MEDICAL_PRIMARY_CARE',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57ffnst8ga2jt6mw5d3y74tm98cq8cx',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17f5r1qqxpfjw87wmkjrw610h8cp6xv',
      date: '2026-02-24',
      name: 'PROFESSIONAL URGENT',
      merchant_name: 'Professional Urgent',
      amount: 130.0,
      category: ['Healthcare', 'Healthcare Services'],
      expectedCategoryId: 'jh7fczzeaqnfbxh58tp42w0ydd8cqpz2',
      personal_finance_category: {
        primary: 'MEDICAL',
        detailed: 'MEDICAL_PRIMARY_CARE',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57b1jnrse39bqqn04crtjw6jn8cp0kb',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm171e0nbxrr9nm4kna27097wj98cpe76',
      date: '2026-07-06',
      name: 'AplPay CIRCLEK #2709TAMPA',
      merchant_name: 'Circle K',
      amount: 51.38,
      category: ['Shops', 'Convenience Stores'],
      expectedCategoryId: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
      personal_finance_category: {
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_GAS',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm57632r47kyd2zn77xy9ead6nn8cqxjc',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17ewwcw592kms4ny2h9yd7mt18cqkyd',
      date: '2026-06-22',
      name: '7-Eleven',
      merchant_name: '7-Eleven',
      amount: 46.62,
      category: ['Shops', 'Convenience Stores'],
      expectedCategoryId: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
      personal_finance_category: {
        primary: 'GENERAL_MERCHANDISE',
        detailed: 'GENERAL_MERCHANDISE_CONVENIENCE_STORES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm577jgdrywcfwbhdzpmd97b7xx8cpm22',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1784nvb5s17xfpayhvzqns2gh8cq9jm',
      date: '2026-01-05',
      name: 'ExxonMobil',
      merchant_name: null,
      amount: 37.87,
      category: ['Travel', 'Gas Stations'],
      expectedCategoryId: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
      personal_finance_category: {
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_GAS',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm570w8b6th5tfbk8h5hcpjk4tn8cqd3g',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17524meqm23rwy5awagffqgb58cqabs',
      date: '2026-06-10',
      name: 'AIR SERBIA A.D BEOGRNOVI BEOGRAD',
      merchant_name: 'Air Serbia A.d Beograd Gr',
      amount: 1536.56,
      category: ['Travel', 'Airlines and Aviation Services'],
      expectedCategoryId: 'jh71f28t9vbzx8y5c9hecjsyvh8cpma8',
      personal_finance_category: {
        primary: 'TRAVEL',
        detailed: 'TRAVEL_FLIGHTS',
        confidence_level: 'HIGH',
      },
    },
  },
  {
    rawImportId: 'm578t9x253vgb2m40w2fmgqtf58cpk48',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm1709qrv0gckppvwzpjz1wd8p58cp4qa',
      date: '2026-06-02',
      name: "Jersey Mike's",
      merchant_name: "Jersey Mike's Subs",
      amount: 11.45,
      category: ['Food and Drink', 'Restaurants', 'Fast Food'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_FAST_FOOD',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm5756jrekd31mzya3agh4w3e8h8cqtfg',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm175b68xywat02n7ebcjfv4x218cpz09',
      date: '2026-06-01',
      name: 'Panda Express',
      merchant_name: 'Panda Express',
      amount: 25.05,
      category: ['Food and Drink', 'Restaurants', 'Fast Food'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_FAST_FOOD',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm573mq15nfb483tcwxkrrj3ze98cqy75',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17199a7ztn1jravmt0hyt4jf18cpfnx',
      date: '2026-05-18',
      name: "McDonald's",
      merchant_name: "McDonald's",
      amount: 9.62,
      category: ['Food and Drink', 'Restaurants', 'Fast Food'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_FAST_FOOD',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm57cadmr8vktr6s8sgx83jfrhd8cq32v',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17ad1arcrb3wtjnyt0ajmrkm18cpap6',
      date: '2026-04-27',
      name: 'Five Guys',
      merchant_name: 'Five Guys',
      amount: 19.55,
      category: ['Food and Drink', 'Restaurants', 'Fast Food'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_FAST_FOOD',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm57fbdnrse41mn4yhc8cgjty958cp8et',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm178gyfv3ewzmcd77t213s3hc18cpcr6',
      date: '2026-03-28',
      name: 'SLICE*HECTORSNYPIZZANEW',
      merchant_name: 'Hectors',
      amount: 26.63,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANT',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm579ztgz9sjnxbew81n6mbqhp98cpccz',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17bvnfhs0y3wtwhcxgfs9hzfx8cqwdj',
      date: '2026-01-10',
      name: 'AplPay THE CRACKED PTampa',
      merchant_name: 'The Cracked',
      amount: 36.75,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh75ej95jnjf4ky087whj851q18cq27m',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANT',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm57bn7sncj9napvce87z9garfn8cqdg8',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm175874gsbr41r92scb4c7s34d8cq4g1',
      date: '2026-06-25',
      name: 'NABU CASA - HA CLOUDSACRAMENTO',
      merchant_name: 'Nabu Casa',
      amount: 6.5,
      category: ['Food and Drink', 'Restaurants'],
      expectedCategoryId: 'jh77mbkqs7hcz0hbrzgesgvbc58cpscw',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_COFFEE',
        confidence_level: 'LOW',
      },
    },
  },
  {
    rawImportId: 'm5721k5j8b9b819p6kyrmv5jxn8cpw8k',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm174z7y9qcwx40ghg377xnjc1h8cq4re',
      date: '2026-01-11',
      name: 'Publix',
      merchant_name: 'Publix',
      amount: 3.4,
      category: ['Shops', 'Supermarkets and Groceries'],
      expectedCategoryId: 'jh76nyb66t5dpq3xbwvrxmazkd8cpacq',
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_GROCERIES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm570wbtpzcr7pgy0076vmf025s8cpen3',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm170486fydfy59ks26jq79st198cprbf',
      date: '2026-01-15',
      name: 'Walmart',
      merchant_name: 'Walmart',
      amount: 177.15,
      category: ['Shops', 'Department Stores'],
      expectedCategoryId: 'jh76nyb66t5dpq3xbwvrxmazkd8cpacq',
      personal_finance_category: {
        primary: 'GENERAL_MERCHANDISE',
        detailed: 'GENERAL_MERCHANDISE_SUPERSTORES',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
  {
    rawImportId: 'm579rz9036yxhvqzvpwq404xwd8cpsha',
    reviewStatusAtCapture: 'reviewed',
    transaction: {
      transaction_id: 'm17aba3paqz99pc7vw9ckemw2d8cpdnt',
      date: '2026-02-03',
      name: 'Circle K',
      merchant_name: 'Circle K',
      amount: 36.66,
      category: ['Shops', 'Convenience Stores'],
      expectedCategoryId: 'jh7c6vszysdm7pcbmbwb7efacd8cqecw',
      personal_finance_category: {
        primary: 'TRANSPORTATION',
        detailed: 'TRANSPORTATION_GAS',
        confidence_level: 'VERY_HIGH',
      },
    },
  },
];

/** Snapshot lookup only; the internal query validates the workspace before calling this. */
export function loadCategorizationBenchmark(
  workspaceId: Id<'workspace'>,
  limit: number
): {
  categories: Array<CategoryInput & { id: Id<'category'> }>;
  samples: ComparisonSample[];
  benchmark: BenchmarkInfo;
} {
  if (workspaceId !== BENCHMARK_WORKSPACE_ID) {
    throw new ConvexError(
      'This fixed benchmark belongs to a different workspace. Use source: "recent" or supply transactions.'
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > cases.length) {
    throw new ConvexError(`Benchmark limit must be an integer from 1 to ${cases.length}`);
  }
  return {
    benchmark: { ...BENCHMARK_INFO },
    categories: categories.map((category) => ({ ...category, id: category.id as Id<'category'> })),
    samples: cases.slice(0, limit).map((sample) => ({
      expectedSource: 'benchmark_snapshot',
      transaction: {
        ...structuredClone(sample.transaction),
        expectedCategoryId: sample.transaction.expectedCategoryId as Id<'category'>,
      },
    })),
  };
}
