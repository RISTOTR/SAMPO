export const transactionColumns = [
  { id: 'date', label: 'Date' },
  { id: 'valueDate', label: 'Value date' },
  { id: 'description', label: 'Description' },
  { id: 'account', label: 'Account' },
  { id: 'amount', label: 'Amount' },
  { id: 'balance', label: 'Balance' },
  { id: 'type', label: 'Type' },
  { id: 'pending', label: 'Pending' },
  { id: 'spending', label: 'Spending' },
  { id: 'review', label: 'Review' },
  { id: 'merchant', label: 'Merchant' },
  { id: 'category', label: 'Category' },
  { id: 'classStatus', label: 'Class status' },
  { id: 'usage', label: 'Usage' },
  { id: 'cost', label: 'Cost' },
  { id: 'necessity', label: 'Necessity' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'actions', label: 'Actions' }
] as const

export type TransactionColumn = (typeof transactionColumns)[number]['id']
export const defaultTransactionColumns: TransactionColumn[] = [
  'date',
  'description',
  'amount',
  'merchant',
  'category',
  'classStatus',
  'recurring',
  'actions'
]
