export interface TransactionTypeField {
  name: string
  required: boolean
  description?: string
  example?: string
  /** If set, this field is mapped to a QuickBooks list instead of a file column */
  fieldType?: 'qb-account' | 'qb-customer' | 'qb-vendor' | 'qb-item'
}

export interface TransactionType {
  id: string
  label: string
  category: 'customer' | 'vendor' | 'banking' | 'other'
  icon: string
  color: string
  description: string
  fields: TransactionTypeField[]
}

export const TRANSACTION_TYPES: TransactionType[] = [
  // Customer Transactions
  {
    id: 'Invoice',
    label: 'Invoice',
    category: 'customer',
    icon: 'FileText',
    color: '#6366F1',
    description: 'Customer invoices for goods or services',
    fields: [
      { name: 'Customer', required: true, description: 'Customer name', example: 'Acme Corp' },
      { name: 'Date', required: true, description: 'Invoice date', example: '01/15/2024' },
      { name: 'Invoice Number', required: false, description: 'Invoice reference number', example: 'INV-001' },
      { name: 'Due Date', required: false, description: 'Payment due date', example: '02/15/2024' },
      { name: 'Item', required: true, description: 'Product or service item', example: 'Consulting Services' },
      { name: 'Description', required: false, description: 'Line item description', example: 'Monthly consulting' },
      { name: 'Quantity', required: false, description: 'Item quantity', example: '5' },
      { name: 'Rate', required: false, description: 'Price per unit', example: '150.00' },
      { name: 'Amount', required: true, description: 'Line item total', example: '750.00' },
      { name: 'Account', required: false, description: 'AR account', example: 'Accounts Receivable', fieldType: 'qb-account' },
      { name: 'Terms', required: false, description: 'Payment terms', example: 'Net 30' },
      { name: 'Memo', required: false, description: 'Additional notes', example: 'January services' }
    ]
  },
  {
    id: 'Sales Receipt',
    label: 'Sales Receipt',
    category: 'customer',
    icon: 'Receipt',
    color: '#8B5CF6',
    description: 'Cash sales paid at time of transaction',
    fields: [
      { name: 'Customer', required: true, example: 'Walk-in Customer' },
      { name: 'Date', required: true, example: '01/15/2024' },
      { name: 'Item', required: true, example: 'Product A' },
      { name: 'Quantity', required: false, example: '2' },
      { name: 'Rate', required: false, example: '49.99' },
      { name: 'Amount', required: true, example: '99.98' },
      { name: 'Deposit Account', required: false, example: 'Checking Account', fieldType: 'qb-account' },
      { name: 'Memo', required: false, example: 'Walk-in sale' }
    ]
  },
  {
    id: 'Receive Payment',
    label: 'Receive Payment',
    category: 'customer',
    icon: 'CreditCard',
    color: '#06B6D4',
    description: 'Payments received against open invoices',
    fields: [
      { name: 'Customer', required: true, example: 'Acme Corp' },
      { name: 'Date', required: true, example: '01/20/2024' },
      { name: 'Amount', required: true, example: '750.00' },
      { name: 'Payment Method', required: false, example: 'Check' },
      { name: 'Reference Number', required: false, example: 'CHK-5542' },
      { name: 'Deposit Account', required: false, example: 'Checking Account', fieldType: 'qb-account' },
      { name: 'Memo', required: false, example: 'Payment for INV-001' }
    ]
  },
  {
    id: 'Credit Memo',
    label: 'Credit Memo',
    category: 'customer',
    icon: 'FileMinus',
    color: '#F59E0B',
    description: 'Credits issued to customers',
    fields: [
      { name: 'Customer', required: true, example: 'Acme Corp' },
      { name: 'Date', required: true, example: '01/15/2024' },
      { name: 'Item', required: true, example: 'Refund' },
      { name: 'Amount', required: true, example: '100.00' },
      { name: 'Memo', required: false, example: 'Returned goods' }
    ]
  },
  {
    id: 'Estimate',
    label: 'Estimate',
    category: 'customer',
    icon: 'ClipboardList',
    color: '#10B981',
    description: 'Customer estimates and quotes',
    fields: [
      { name: 'Customer', required: true, example: 'Acme Corp' },
      { name: 'Date', required: true, example: '01/15/2024' },
      { name: 'Estimate Number', required: false, example: 'EST-001' },
      { name: 'Item', required: true, example: 'Custom Work' },
      { name: 'Quantity', required: false, example: '10' },
      { name: 'Rate', required: false, example: '75.00' },
      { name: 'Amount', required: true, example: '750.00' }
    ]
  },

  // Vendor Transactions
  {
    id: 'Bill',
    label: 'Bill',
    category: 'vendor',
    icon: 'FileInput',
    color: '#EF4444',
    description: 'Vendor bills and accounts payable',
    fields: [
      { name: 'Vendor', required: true, example: 'Office Supply Co' },
      { name: 'Date', required: true, example: '01/10/2024' },
      { name: 'Bill Number', required: false, example: 'BILL-123' },
      { name: 'Due Date', required: false, example: '02/10/2024' },
      { name: 'Account', required: true, example: 'Office Supplies', fieldType: 'qb-account' },
      { name: 'Amount', required: true, example: '250.00' },
      { name: 'Description', required: false, example: 'Office supplies for January' },
      { name: 'Memo', required: false, example: 'Monthly supplies' }
    ]
  },
  {
    id: 'Bill Payment',
    label: 'Bill Payment',
    category: 'vendor',
    icon: 'Send',
    color: '#F97316',
    description: 'Payments made against vendor bills',
    fields: [
      { name: 'Vendor', required: true, example: 'Office Supply Co' },
      { name: 'Date', required: true, example: '01/25/2024' },
      { name: 'Amount', required: true, example: '250.00' },
      { name: 'Account', required: true, example: 'Checking Account', fieldType: 'qb-account' },
      { name: 'Check Number', required: false, example: '1042' },
      { name: 'Memo', required: false, example: 'Payment for BILL-123' }
    ]
  },
  {
    id: 'Purchase Order',
    label: 'Purchase Order',
    category: 'vendor',
    icon: 'ShoppingCart',
    color: '#84CC16',
    description: 'Purchase orders to vendors',
    fields: [
      { name: 'Vendor', required: true, example: 'Tech Supplier Inc' },
      { name: 'Date', required: true, example: '01/05/2024' },
      { name: 'PO Number', required: false, example: 'PO-2024-001' },
      { name: 'Item', required: true, example: 'Laptop' },
      { name: 'Quantity', required: false, example: '5' },
      { name: 'Rate', required: false, example: '1200.00' },
      { name: 'Amount', required: true, example: '6000.00' }
    ]
  },
  {
    id: 'Credit Card Charge',
    label: 'Credit Card Charge',
    category: 'vendor',
    icon: 'Wallet',
    color: '#EC4899',
    description: 'Credit card purchases and charges',
    fields: [
      { name: 'Account', required: true, example: 'Business Visa', fieldType: 'qb-account' },
      { name: 'Vendor', required: false, example: 'Amazon' },
      { name: 'Date', required: true, example: '01/15/2024' },
      { name: 'Amount', required: true, example: '89.99' },
      { name: 'Expense Account', required: true, example: 'Office Expenses', fieldType: 'qb-account' },
      { name: 'Memo', required: false, example: 'Office supplies' }
    ]
  },

  // Banking Transactions
  {
    id: 'Check',
    label: 'Check',
    category: 'banking',
    icon: 'BookOpen',
    color: '#14B8A6',
    description: 'Written checks from bank accounts',
    fields: [
      // "Bank Account" = QB picker (selected once for ALL rows) → BankAccountRef
      // Matches QB Batch Enter Transactions: TRANSACTION TYPE=Checks, BANK ACCOUNT=...
      // All other fields map from your file columns (DATE, PAYEE, ACCOUNT, AMOUNT, MEMO)
      { name: 'Bank Account', required: true, example: 'Bank of Phantom', fieldType: 'qb-account', description: 'Bank account all these checks are drawn from — selected once for all rows' },
      { name: 'Date', required: true, example: '01/15/2024' },
      { name: 'Payee', required: true, example: 'John Smith' },
      { name: 'Account', required: true, example: 'Sales', description: 'Expense / income account from your file (e.g. Sales, Office Supplies)' },
      { name: 'Amount', required: true, example: '500.00' },
      { name: 'Memo', required: false, example: 'Zelle payment' },
      { name: 'Check Number', required: false, example: '1041' }
    ]
  },
  {
    id: 'Deposit',
    label: 'Deposit',
    category: 'banking',
    icon: 'ArrowDownCircle',
    color: '#22C55E',
    description: 'Bank account deposits',
    fields: [
      // "Bank Account" = QB picker (DepositToAccountRef) — selected once for all rows
      // Matches QB Batch Enter Transactions: TRANSACTION TYPE=Deposits, BANK ACCOUNT=...
      { name: 'Bank Account', required: true, example: 'Bank of Phantom', fieldType: 'qb-account', description: 'Bank account receiving all these deposits — selected once for all rows' },
      { name: 'Date', required: true, example: '01/20/2024' },
      { name: 'Payee', required: false, example: 'Acme Corp', description: 'Customer or entity making the deposit' },
      { name: 'Account', required: true, example: 'Sales', description: 'Income / source account from your file (e.g. Sales, Undeposited Funds)' },
      { name: 'Amount', required: true, example: '2500.00' },
      { name: 'Memo', required: false, example: 'Customer payment deposit' }
    ]
  },
  {
    id: 'Transfer',
    label: 'Transfer',
    category: 'banking',
    icon: 'ArrowLeftRight',
    color: '#A78BFA',
    description: 'Transfers between bank accounts',
    fields: [
      // Both account fields come from file columns (account names in the CSV)
      { name: 'Date', required: true, example: '01/25/2024' },
      { name: 'From Account', required: true, example: 'Checking Account', description: 'Bank account sending the funds' },
      { name: 'To Account', required: true, example: 'Savings Account', description: 'Bank account receiving the funds' },
      { name: 'Amount', required: true, example: '1000.00' },
      { name: 'Memo', required: false, example: 'Monthly savings transfer' }
    ]
  },

  // Other
  {
    id: 'Journal Entry',
    label: 'Journal Entry',
    category: 'other',
    icon: 'BookMarked',
    color: '#F59E0B',
    description: 'General ledger journal entries',
    fields: [
      { name: 'Date', required: true, example: '01/31/2024' },
      { name: 'Reference', required: false, example: 'JE-001' },
      { name: 'Debit Account', required: true, example: 'Office Expenses', fieldType: 'qb-account' },
      { name: 'Debit Amount', required: true, example: '500.00' },
      { name: 'Credit Account', required: true, example: 'Cash', fieldType: 'qb-account' },
      { name: 'Credit Amount', required: true, example: '500.00' },
      { name: 'Entity', required: false, example: 'Acme Corp' },
      { name: 'Memo', required: false, example: 'Accrued expenses' }
    ]
  }
]

export const TRANSACTION_CATEGORIES = [
  { id: 'customer', label: 'Customer Transactions', color: '#6366F1' },
  { id: 'vendor', label: 'Vendor Transactions', color: '#EF4444' },
  { id: 'banking', label: 'Banking Transactions', color: '#14B8A6' },
  { id: 'other', label: 'Other', color: '#F59E0B' }
] as const

export function getTransactionType(id: string): TransactionType | undefined {
  return TRANSACTION_TYPES.find((t) => t.id === id)
}
