"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";

interface Payment {
  _id: string;
  amountCents: number;
  date: string;
  note?: string;
  createdAt: string;
}

interface OrderDetail {
  _id: string;
  customer: string;
  dueDate: string;
  status: string;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  lineItems: { description: string; quantity: number; unitPriceCents: number }[];
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  partially_paid: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};

export default function OrderDetailModal({
  orderId,
  onClose,
  onUpdated,
}: {
  orderId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment form
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [payNote, setPayNote] = useState("");
  const [payError, setPayError] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    loadData();
  }, [orderId]);

  async function loadData() {
    setLoading(true);
    try {
      const [orderRes, payRes] = await Promise.all([
        api.getOrder(orderId),
        api.getPayments(orderId),
      ]);
      setOrder(orderRes.order);
      setPayments(payRes.payments);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    setPayError("");
    setPaying(true);
    try {
      const amountCents = Math.round(parseFloat(payAmount) * 100);
      if (amountCents < 1) {
        setPayError("Amount must be at least $0.01");
        return;
      }
      await api.recordPayment(orderId, {
        amountCents,
        date: payDate,
        note: payNote || undefined,
      });
      setPayAmount("");
      setPayNote("");
      await loadData();
      onUpdated();
    } catch (err: any) {
      setPayError(err.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">Loading...</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          Order not found.{" "}
          <button onClick={onClose} className="text-blue-600">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {order.customer}
              </h2>
              <p className="text-sm text-gray-500">Due: {order.dueDate}</p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[order.status] || ""}`}
              >
                {order.status.replace("_", " ")}
              </span>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">
                &times;
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">Order Total</div>
              <div className="text-lg font-bold">{formatMoney(order.totalCents)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">Amount Paid</div>
              <div className="text-lg font-bold text-green-700">
                {formatMoney(order.paidCents)}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-500 uppercase">Amount Due</div>
              <div className="text-lg font-bold text-red-700">
                {formatMoney(order.dueCents)}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Line Items</h3>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs text-gray-500">Description</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Qty</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Unit Price</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {order.lineItems.map((item, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-right">
                        {formatMoney(item.unitPriceCents)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatMoney(item.quantity * item.unitPriceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment History */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Payment History ({payments.length})
            </h3>
            {payments.length === 0 ? (
              <p className="text-sm text-gray-500">No payments recorded yet.</p>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs text-gray-500">Date</th>
                      <th className="px-3 py-2 text-right text-xs text-gray-500">Amount</th>
                      <th className="px-3 py-2 text-left text-xs text-gray-500">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {payments.map((p) => (
                      <tr key={p._id}>
                        <td className="px-3 py-2">{p.date}</td>
                        <td className="px-3 py-2 text-right font-medium text-green-700">
                          {formatMoney(p.amountCents)}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {p.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Record Payment Form */}
          {order.status !== "paid" && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Record Payment
              </h3>
              <form onSubmit={handlePayment} className="flex gap-3 items-end flex-wrap">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={(order.dueCents / 100).toFixed(2)}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                    placeholder="0.00"
                    className="w-32 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    required
                    className="px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Note (optional)</label>
                  <input
                    type="text"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder="e.g. Bank transfer"
                    className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={paying}
                  className="px-4 py-2 text-sm text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {paying ? "..." : "Record Payment"}
                </button>
              </form>
              {payError && (
                <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded-md">
                  {payError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
