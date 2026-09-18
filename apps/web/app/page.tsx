"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bell,
  Bolt,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  FileText,
  Filter,
  LayoutDashboard,
  Building2,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

import {
  ApiError,
  authApi,
  businessApi,
  businessSessionKey,
  type BusinessSession,
  type CompanyRecord,
  type ConversationRecord,
  type PendingApplicationsSummary,
  type PaymentRecord,
  type ShiftApplicationRecord,
  type SubscriptionRecord,
  type ShiftRecord,
  type WorkerRecord,
  type TalentCardRecord,
  type SpecialtyRecord,
  type BusinessTalentInvitationRecord,
  type TalentInvitationStatus,
} from "../lib/business-api";
import { BusinessAuth } from "../components/business-auth";
import { CrudModal } from "../components/crud-modal";

type ViewName =
  | "Resumen"
  | "Turnos"
  | "Trabajadores"
  | "Mensajes"
  | "Pagos"
  | "Membresía";
type Coverage = "Completo" | "Falta 1" | "En selección";
type Shift = {
  id: string;
  role: string;
  date: string;
  schedule: string;
  location: string;
  confirmed: number;
  required: number;
  pay: number;
  coverage: Coverage;
  startsAt: string;
  endsAt: string;
  status: ShiftRecord["status"];
  rescueActive: boolean;
  description?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  screeningQuestions: string[];
  modality: ShiftRecord["modality"];
  notes?: string | null;
};
type Worker = {
  id: string;
  initials: string;
  name: string;
  role: string;
  available: string;
  status: "Disponible" | "En turno" | "No disponible";
  skills: string[];
  email?: string | null;
  phone?: string | null;
};
type Conversation = {
  id: string;
  workerId: string;
  shiftId?: string | null;
  initials: string;
  name: string;
  role: string;
  preview: string;
  time: string;
  unread: number;
  online: boolean;
  subject: string;
  status: "OPEN" | "ARCHIVED";
};
type ChatMessage = {
  id: string;
  sender: "company" | "worker";
  text: string;
  time: string;
};
type Transaction = {
  id: string;
  description: string;
  workerName: string | null;
  date: string;
  workers: number;
  amount: number;
  status: "Procesado" | "Pendiente" | "Programado" | "Cancelado";
  rawStatus: PaymentRecord["status"];
  reference: string;
  dueAt: string | null;
};
type ModalKind = "worker" | "payment" | "conversation" | "company" | null;

const navigation: {
  label: ViewName;
  icon: typeof LayoutDashboard;
  badge?: string;
}[] = [
    { label: "Resumen", icon: LayoutDashboard },
    { label: "Turnos", icon: CalendarDays },
    { label: "Trabajadores", icon: Users },
    { label: "Mensajes", icon: MessageSquareText },
    { label: "Pagos", icon: CircleDollarSign },
    { label: "Membresía", icon: BadgeCheck },
  ];

const initialShifts: Shift[] = [];
const initialWorkers: Worker[] = [];
const initialConversations: Conversation[] = [];
const initialMessages: Record<string, ChatMessage[]> = {};
const initialTransactions: Transaction[] = [];

// El servidor no transiciona automáticamente un turno por tiempo (ver
// `ShiftStatus` en `schema.prisma`): un turno cuyo `endsAt` ya pasó puede
// seguir en `status: "PUBLISHED"`/`"ASSIGNED"` para siempre si la empresa no
// lo cancela. Sin este chequeo, los contadores "activos" del panel lo
// contaban como si todavía aceptara postulaciones, aunque el resto del
// sistema (búsqueda del trabajador, postulación, aceptación) ya lo trata
// como cerrado.
function isShiftExpired(shift: Pick<Shift, "endsAt">) {
  return new Date(shift.endsAt).getTime() <= Date.now();
}

function coverageClass(coverage: Coverage) {
  if (coverage === "Completo") return "complete";
  if (coverage === "Falta 1") return "urgent";
  return "";
}

const dateTimeFormat = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
});

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "CN"
  );
}
function mapShift(record: ShiftRecord): Shift {
  const coverage: Coverage =
    record.confirmedWorkers >= record.requiredWorkers
      ? "Completo"
      : record.requiredWorkers - record.confirmedWorkers === 1
        ? "Falta 1"
        : "En selección";
  return {
    id: record.id,
    role: record.title,
    date: dateTimeFormat.format(new Date(record.startsAt)),
    schedule: `${timeFormat.format(new Date(record.startsAt))} – ${timeFormat.format(new Date(record.endsAt))}`,
    location: record.location,
    confirmed: record.confirmedWorkers,
    required: record.requiredWorkers,
    pay: record.payCents / 100,
    coverage,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    status: record.status,
    rescueActive: record.rescueActive,
    description: record.description,
    responsibilities: record.responsibilities,
    requirements: record.requirements,
    screeningQuestions: record.screeningQuestions ?? [],
    modality: record.modality,
    notes: record.notes,
  };
}
function mapWorker(record: WorkerRecord): Worker {
  const status =
    record.status === "AVAILABLE"
      ? "Disponible"
      : record.status === "ON_SHIFT"
        ? "En turno"
        : "No disponible";
  return {
    id: record.id,
    initials: initials(record.name),
    name: record.name,
    role: record.role,
    available: record.availability ?? status,
    status,
    skills: record.skills,
    email: record.email,
    phone: record.phone,
  };
}
function mapConversation(record: ConversationRecord): Conversation {
  const last = record.messages.at(-1);
  return {
    id: record.id,
    workerId: record.workerId,
    shiftId: record.shiftId,
    initials: initials(record.worker.name),
    name: record.worker.name,
    role: record.worker.role,
    preview: last?.body ?? "Conversación sin mensajes",
    time: timeFormat.format(new Date(record.updatedAt)),
    unread: record.messages.filter(
      (message) => message.sender === "WORKER" && !message.readAt,
    ).length,
    online: record.worker.status === "AVAILABLE",
    subject: record.subject,
    status: record.status,
  };
}
function mapMessages(record: ConversationRecord): ChatMessage[] {
  return record.messages.map((message) => ({
    id: message.id,
    sender: message.sender === "BUSINESS" ? "company" : "worker",
    text: message.body,
    time: timeFormat.format(new Date(message.createdAt)),
  }));
}
function mapPayment(record: PaymentRecord): Transaction {
  const labels = {
    PENDING: "Pendiente",
    SCHEDULED: "Programado",
    PROCESSED: "Procesado",
    CANCELLED: "Cancelado",
  } as const;
  return {
    id: record.id,
    reference: record.reference,
    description: record.description,
    workerName: record.assignment?.worker.name ?? null,
    date: dateFormat.format(new Date(record.dueAt ?? record.createdAt)),
    workers: record.workerCount,
    amount: record.amountCents / 100,
    status: labels[record.status],
    rawStatus: record.status,
    dueAt: record.dueAt?.slice(0, 10) ?? null,
  };
}

const INVITATION_STATUS_LABEL: Record<TalentInvitationStatus, string> = {
  PENDING: "Pendiente",
  ACCEPTED: "Aceptada",
  DECLINED: "Rechazada",
  EXPIRED: "Vencida",
  CANCELLED: "Cancelada",
};

export default function HomePage() {
  const [authChecking, setAuthChecking] = useState(true);
  const [session, setSession] = useState<BusinessSession | null>(null);
  const [company, setCompany] = useState<CompanyRecord | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(
    null,
  );
  const [activeNav, setActiveNav] = useState<ViewName>("Resumen");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [shiftFilter, setShiftFilter] = useState<
    "Todos" | "Por cubrir" | "Completos"
  >("Todos");
  const [period, setPeriod] = useState("Esta semana");
  const [rescueActive, setRescueActive] = useState(false);
  const [shifts, setShifts] = useState(initialShifts);
  const [shiftSearch, setShiftSearch] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [shiftApplications, setShiftApplications] = useState<
    ShiftApplicationRecord[]
  >([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState<string | null>(
    null,
  );
  const [applicationsShiftId, setApplicationsShiftId] = useState("");
  const [pendingApplications, setPendingApplications] =
    useState<PendingApplicationsSummary>({ count: 0, shiftIds: [] });
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [workerRecords, setWorkerRecords] = useState(initialWorkers);
  const [workerSearch, setWorkerSearch] = useState("");
  const [workerFilter, setWorkerFilter] = useState<
    "Todos" | "Disponibles" | "En turno"
  >("Todos");
  const [talent, setTalent] = useState<TalentCardRecord[]>([]);
  const [talentSpecialties, setTalentSpecialties] = useState<SpecialtyRecord[]>([]);
  const [talentSpecialty, setTalentSpecialty] = useState("");
  const [talentAvailableOnly, setTalentAvailableOnly] = useState(false);
  const [talentQueryInput, setTalentQueryInput] = useState("");
  const [talentQuery, setTalentQuery] = useState("");
  const [talentDistrictInput, setTalentDistrictInput] = useState("");
  const [talentDistrict, setTalentDistrict] = useState("");
  const [talentLoading, setTalentLoading] = useState(false);
  const [talentError, setTalentError] = useState<string | null>(null);
  const [talentNextCursor, setTalentNextCursor] = useState<string | null>(null);
  const [talentLoadingMore, setTalentLoadingMore] = useState(false);
  const talentRequestId = useRef(0);
  const [invitingProfileId, setInvitingProfileId] = useState<string | null>(null);
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [sentInvitations, setSentInvitations] = useState<BusinessTalentInvitationRecord[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [conversationRecords, setConversationRecords] =
    useState(initialConversations);
  const [selectedConversation, setSelectedConversation] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [chatMessages, setChatMessages] = useState(initialMessages);
  const [paymentRecords, setPaymentRecords] = useState(initialTransactions);
  const [paymentFilter, setPaymentFilter] = useState<
    "Todos" | "Procesados" | "Pendientes"
  >("Todos");
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(businessSessionKey);
    if (!stored) {
      setAuthChecking(false);
      return;
    }
    try {
      const saved = JSON.parse(stored) as BusinessSession;
      authApi
        .restore(saved.token)
        .then((restored) => {
          if (restored.role !== "BUSINESS")
            throw new ApiError(403, "BUSINESS_ACCOUNT_REQUIRED");
          setSession(restored);
          window.localStorage.setItem(
            businessSessionKey,
            JSON.stringify(restored),
          );
        })
        .catch(() => window.localStorage.removeItem(businessSessionKey))
        .finally(() => setAuthChecking(false));
    } catch {
      window.localStorage.removeItem(businessSessionKey);
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    if (session) void loadData(session.token);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const refreshPending = async () => {
      try {
        const summary = await businessApi.applications.pending(session.token);
        if (!cancelled) setPendingApplications(summary);
      } catch {
        // The next poll retries without interrupting the current view.
      }
    };
    void refreshPending();
    const timer = window.setInterval(() => void refreshPending(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    if (!session || activeNav !== "Pagos") return;
    let cancelled = false;
    const refreshPayments = async () => {
      try {
        const records = await businessApi.payments.list(session.token);
        if (!cancelled) setPaymentRecords(records.map(mapPayment));
      } catch {
        // The main loader and the next interval will retry without interrupting
        // the payment workflow currently visible to the business.
      }
    };
    void refreshPayments();
    const timer = window.setInterval(() => void refreshPayments(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeNav, session]);

  useEffect(() => {
    if (!session || !selectedShiftId || activeNav !== "Turnos") {
      setShiftApplications([]);
      setApplicationsError(null);
      setApplicationsShiftId("");
      setApplicationsLoading(false);
      return;
    }
    let cancelled = false;
    setShiftApplications([]);
    setApplicationsError(null);
    setApplicationsShiftId("");
    setApplicationsLoading(true);
    const refreshApplications = async () => {
      try {
        const applications = await businessApi.applications.list(
          session.token,
          selectedShiftId,
        );
        if (!cancelled) {
          setShiftApplications(applications);
          setApplicationsError(null);
          setApplicationsShiftId(selectedShiftId);
        }
      } catch {
        if (!cancelled) {
          setShiftApplications([]);
          setApplicationsError(
            "No pudimos cargar las postulaciones de este turno. Inténtalo nuevamente en unos segundos.",
          );
          setApplicationsShiftId(selectedShiftId);
        }
      } finally {
        if (!cancelled) setApplicationsLoading(false);
      }
    };
    void refreshApplications();
    const timer = window.setInterval(() => void refreshApplications(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeNav, session, selectedShiftId]);

  useEffect(() => {
    if (!session || activeNav !== "Mensajes") return;
    let cancelled = false;
    const refreshMessages = async () => {
      try {
        const list = await businessApi.conversations.list(session.token);
        if (cancelled) return;
        const mapped = list.map(mapConversation);
        setConversationRecords(mapped);
        const conversationId =
          selectedConversation &&
            mapped.some((item) => item.id === selectedConversation)
            ? selectedConversation
            : (mapped[0]?.id ?? "");
        setSelectedConversation(conversationId);
        if (conversationId) {
          const full = await businessApi.conversations.get(
            session.token,
            conversationId,
          );
          if (!cancelled) {
            setChatMessages((current) => ({
              ...current,
              [conversationId]: mapMessages(full),
            }));
          }
        }
      } catch {
        // The next poll retries without interrupting the current conversation.
      }
    };
    void refreshMessages();
    const timer = window.setInterval(() => void refreshMessages(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeNav, selectedConversation, session]);
  useEffect(() => {
    const timer = window.setTimeout(() => setTalentQuery(talentQueryInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [talentQueryInput]);
  useEffect(() => {
    const timer = window.setTimeout(() => setTalentDistrict(talentDistrictInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [talentDistrictInput]);
  useEffect(() => {
    if (!session || activeNav !== "Trabajadores") return;
    const requestId = ++talentRequestId.current;
    setTalentLoading(true);
    setTalentError(null);
    // A stale per-card invite error belongs to the previous search/filter result;
    // it must not stay pinned under a card that no longer matches the new criteria.
    setInviteErrors({});
    Promise.all([
      businessApi.talent.specialties(session.token),
      businessApi.talent.search(session.token, {
        specialtyId: talentSpecialty || undefined,
        district: talentDistrict || undefined,
        query: talentQuery || undefined,
        availableOnly: talentAvailableOnly,
      }),
    ])
      .then(([specialties, result]) => {
        if (talentRequestId.current !== requestId) return;
        setTalentSpecialties(specialties);
        setTalent(result.items);
        setTalentNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (talentRequestId.current !== requestId) return;
        setTalent([]);
        setTalentNextCursor(null);
        setTalentError("No se pudo cargar el talento disponible. Intenta de nuevo.");
      })
      .finally(() => {
        if (talentRequestId.current !== requestId) return;
        setTalentLoading(false);
      });
  }, [activeNav, session, talentSpecialty, talentAvailableOnly, talentDistrict, talentQuery]);
  async function loadMoreTalent() {
    if (!session || !talentNextCursor || talentLoadingMore) return;
    const requestId = talentRequestId.current;
    setTalentLoadingMore(true);
    setTalentError(null);
    try {
      const result = await businessApi.talent.search(session.token, {
        specialtyId: talentSpecialty || undefined,
        district: talentDistrict || undefined,
        query: talentQuery || undefined,
        availableOnly: talentAvailableOnly,
        cursor: talentNextCursor,
      });
      // A stale response (filters changed while this request was in flight) must not
      // overwrite newer results, but the loading flag below is reset unconditionally:
      // it belongs to this call's lifecycle, not to whether its data is still relevant.
      if (talentRequestId.current !== requestId) return;
      setTalent((current) => [...current, ...result.items]);
      setTalentNextCursor(result.nextCursor);
    } catch {
      if (talentRequestId.current !== requestId) return;
      setTalentError("No se pudieron cargar más perfiles. Intenta de nuevo.");
    } finally {
      setTalentLoadingMore(false);
    }
  }
  const invitationsRequestId = useRef(0);
  // Ids created locally by `inviteTalent` that a slower, already-in-flight `GET`
  // (started before that creation) cannot yet know about. A stale response is a
  // snapshot from before the create; it must be merged, never used to replace
  // the list outright, or a real success flips back to "not invited" on screen.
  const locallyCreatedInvitationIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!session || activeNav !== "Trabajadores") return;
    const requestId = ++invitationsRequestId.current;
    setInvitationsLoading(true);
    setInvitationsError(null);
    businessApi.talent.invitations
      .list(session.token)
      .then((result) => {
        if (invitationsRequestId.current !== requestId) return;
        setSentInvitations((current) => {
          const resultIds = new Set(result.map((invitation) => invitation.id));
          const missingLocal = current.filter(
            (invitation) =>
              locallyCreatedInvitationIds.current.has(invitation.id) &&
              !resultIds.has(invitation.id),
          );
          return [...missingLocal, ...result];
        });
      })
      .catch(() => {
        if (invitationsRequestId.current !== requestId) return;
        setInvitationsError("No se pudieron cargar las invitaciones enviadas. Intenta de nuevo.");
      })
      .finally(() => {
        if (invitationsRequestId.current !== requestId) return;
        setInvitationsLoading(false);
      });
  }, [activeNav, session]);
  // Perfiles con una invitación activa (PENDING o ACCEPTED) según el listado real del
  // servidor: nunca se marca "invitado" de forma optimista sólo por haber hecho clic.
  const activelyInvitedProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const invitation of sentInvitations) {
      if (invitation.status === "PENDING" || invitation.status === "ACCEPTED") {
        ids.add(invitation.workerTalentProfileId);
      }
    }
    return ids;
  }, [sentInvitations]);
  async function inviteTalent(profileId: string) {
    if (!session || invitingProfileId) return;
    setInvitingProfileId(profileId);
    setInviteErrors((current) => {
      if (!(profileId in current)) return current;
      const next = { ...current };
      delete next[profileId];
      return next;
    });
    try {
      const created = await businessApi.talent.invitations.create(session.token, {
        workerTalentProfileId: profileId,
      });
      locallyCreatedInvitationIds.current.add(created.id);
      setSentInvitations((current) => [created, ...current]);
      showToast(`Invitación enviada a ${created.workerName}.`);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      const message =
        code === "INVITATION_ALREADY_ACTIVE"
          ? "Ya existe una invitación activa para este perfil."
          : code === "TALENT_PROFILE_NOT_AVAILABLE"
            ? "Este perfil ya no está disponible para invitar."
            : "No se pudo enviar la invitación. Intenta de nuevo.";
      setInviteErrors((current) => ({ ...current, [profileId]: message }));
    } finally {
      setInvitingProfileId(null);
    }
  }

  async function loadData(token: string) {
    setDataLoading(true);
    try {
      const [
        companyData,
        subscriptionData,
        shiftData,
        workerData,
        conversationList,
        paymentData,
        pendingData,
      ] = await Promise.all([
        businessApi.company.get(token),
        businessApi.subscription.get(token),
        businessApi.shifts.list(token),
        businessApi.workers.list(token),
        businessApi.conversations.list(token),
        businessApi.payments.list(token),
        businessApi.applications.pending(token),
      ]);
      const fullConversations = await Promise.all(
        conversationList.map((conversation) =>
          businessApi.conversations.get(token, conversation.id),
        ),
      );
      const nextShifts = shiftData.map(mapShift);
      const nextConversations = fullConversations.map(mapConversation);
      setCompany(companyData);
      setSubscription(subscriptionData);
      setShifts(nextShifts);
      setWorkerRecords(workerData.map(mapWorker));
      setConversationRecords(nextConversations);
      setPaymentRecords(paymentData.map(mapPayment));
      setPendingApplications(pendingData);
      setChatMessages(
        Object.fromEntries(
          fullConversations.map((conversation) => [
            conversation.id,
            mapMessages(conversation),
          ]),
        ),
      );
      setSelectedShiftId((current) =>
        nextShifts.some((shift) => shift.id === current)
          ? current
          : (nextShifts[0]?.id ?? ""),
      );
      setSelectedConversation((current) =>
        nextConversations.some((conversation) => conversation.id === current)
          ? current
          : (nextConversations[0]?.id ?? ""),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await logout();
      else showToast("No se pudieron cargar los datos. Intenta nuevamente.");
    } finally {
      setDataLoading(false);
    }
  }

  const filteredShifts = useMemo(
    () =>
      shifts.filter((shift) => {
        const matchesStatus =
          shiftFilter === "Todos" ||
          (shiftFilter === "Por cubrir"
            ? shift.coverage !== "Completo"
            : shift.coverage === "Completo");
        const query = shiftSearch.trim().toLowerCase();
        return (
          matchesStatus &&
          (!query ||
            `${shift.role} ${shift.location} ${shift.date}`
              .toLowerCase()
              .includes(query))
        );
      }),
    [shiftFilter, shiftSearch, shifts],
  );
  const filteredWorkers = useMemo(
    () =>
      workerRecords.filter((worker) => {
        const matchesStatus =
          workerFilter === "Todos" ||
          (workerFilter === "Disponibles"
            ? worker.status === "Disponible"
            : worker.status === "En turno");
        const query = workerSearch.trim().toLowerCase();
        return (
          matchesStatus &&
          (!query ||
            `${worker.name} ${worker.role} ${worker.skills.join(" ")}`
              .toLowerCase()
              .includes(query))
        );
      }),
    [workerFilter, workerRecords, workerSearch],
  );
  const filteredConversations = conversationRecords.filter((item) =>
    `${item.name} ${item.role}`
      .toLowerCase()
      .includes(messageSearch.trim().toLowerCase()),
  );
  const unreadMessages = conversationRecords.reduce(
    (sum, item) => sum + item.unread,
    0,
  );
  const selectedConversationData =
    conversationRecords.find((item) => item.id === selectedConversation) ??
    conversationRecords[0];
  const selectedConversationId =
    selectedConversation || selectedConversationData?.id || "";
  const selectedShift =
    shifts.find((shift) => shift.id === selectedShiftId) ?? shifts[0];
  const applicationsMatchSelectedShift =
    applicationsShiftId === selectedShiftId;
  const periodStart = useMemo(() => {
    const days = period === "Esta semana" ? 7 : period === "Este mes" ? 31 : 30;
    const start = new Date();
    start.setDate(start.getDate() - days);
    return start;
  }, [period]);
  const periodPayments = useMemo(
    () =>
      paymentRecords.filter((item) => {
        const date = item.dueAt ? new Date(item.dueAt) : new Date(item.date);
        return date >= periodStart;
      }),
    [paymentRecords, periodStart],
  );
  const filteredTransactions = periodPayments.filter(
    (item) =>
      paymentFilter === "Todos" ||
      (paymentFilter === "Procesados"
        ? item.status === "Procesado"
        : item.status !== "Procesado"),
  );
  const modalRecord: Record<string, unknown> | null =
    modalKind === "worker"
      ? (() => {
        const worker = workerRecords.find((item) => item.id === editingId);
        return worker
          ? {
            ...worker,
            rawStatus:
              worker.status === "Disponible"
                ? "AVAILABLE"
                : worker.status === "En turno"
                  ? "ON_SHIFT"
                  : "UNAVAILABLE",
          }
          : null;
      })()
      : modalKind === "payment"
        ? ((paymentRecords.find((item) => item.id === editingId) as unknown as
          Record<string, unknown> | undefined) ?? null)
        : modalKind === "conversation"
          ? ((conversationRecords.find(
            (item) => item.id === editingId,
          ) as unknown as Record<string, unknown> | undefined) ?? null)
          : null;

  function navigate(label: ViewName) {
    setActiveNav(label);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }
  function authenticated(nextSession: BusinessSession) {
    window.localStorage.setItem(
      businessSessionKey,
      JSON.stringify(nextSession),
    );
    setSession(nextSession);
  }
  async function logout() {
    const token = session?.token;
    setSession(null);
    setCompany(null);
    setSubscription(null);
    setShifts([]);
    setWorkerRecords([]);
    setConversationRecords([]);
    setPaymentRecords([]);
    setPendingApplications({ count: 0, shiftIds: [] });
    // Invitation state is keyed by account, not by component lifetime: the root
    // component never unmounts on logout (it just swaps in <BusinessAuth />), so
    // without this a second BUSINESS account signing in on the same tab would
    // inherit the previous account's invitations list and "already invited"
    // button state. See CN-20260915-083 MEDIO-1.
    setSentInvitations([]);
    setInvitationsError(null);
    setInviteErrors({});
    setInvitingProfileId(null);
    locallyCreatedInvitationIds.current.clear();
    window.localStorage.removeItem(businessSessionKey);
    if (token) await authApi.logout(token).catch(() => undefined);
  }
  async function publishShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    const screeningQuestions = String(data.get("screeningQuestions") || "")
      .split(/\r?\n/)
      .map((question) => question.trim())
      .filter(Boolean);
    const input = {
      title: String(data.get("role")),
      location: String(data.get("location")),
      startsAt: new Date(String(data.get("startsAt"))).toISOString(),
      endsAt: new Date(String(data.get("endsAt"))).toISOString(),
      requiredWorkers: Number(data.get("required") || 1),
      payCents: Math.round(Number(data.get("pay") || 0) * 100),
      description: String(data.get("description") || "") || null,
      responsibilities: String(data.get("responsibilities") || "") || null,
      requirements: String(data.get("requirements") || "") || null,
      screeningQuestions,
      modality: String(
        data.get("modality") || "PRESENCIAL",
      ) as ShiftRecord["modality"],
      notes: String(data.get("notes") || "") || null,
    };
    setSaving(true);
    try {
      const saved = editingShift
        ? await businessApi.shifts.update(session.token, editingShift.id, input)
        : await businessApi.shifts.create(session.token, input);
      const mapped = mapShift(saved);
      setShifts((current) =>
        editingShift
          ? current.map((shift) => (shift.id === mapped.id ? mapped : shift))
          : [mapped, ...current],
      );
      setSelectedShiftId(mapped.id);
      setEditingShift(null);
      setPublishOpen(false);
      setShiftFilter("Todos");
      navigate("Turnos");
      showToast(
        editingShift
          ? "Turno actualizado correctamente."
          : "Turno publicado. Ya puedes asignar talento.",
      );
    } catch (error) {
      // `SHIFT_ALREADY_ENDED` (el `endsAt` enviado ya pasó) y
      // `SHIFT_NOT_EDITABLE` (el turno persistido ya venció, sin importar qué
      // se edite) son ambos previsibles con `isShiftExpired`/el `min` del
      // campo "Fin", pero pueden seguir ocurriendo por una condición de
      // carrera de UI (el reloj avanzó entre que se abrió el formulario y se
      // envió). El mensaje debe explicar el motivo real, no uno genérico. Ver
      // CN-20260916-099 MEDIO-2.
      const code = error instanceof ApiError ? error.code : null;
      showToast(
        code === "SHIFT_ALREADY_ENDED" || code === "SHIFT_NOT_EDITABLE"
          ? "Este turno ya venció: no se puede guardar con una fecha de fin en el pasado."
          : "No pudimos guardar el turno. Revisa las fechas y datos.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("message") || "").trim();
    if (!session || !selectedConversationId) {
      showToast("Selecciona una conversación antes de enviar el mensaje.");
      return;
    }
    if (!text) return;
    try {
      const saved = await businessApi.conversations.createMessage(
        session.token,
        selectedConversationId,
        text,
      );
      const mapped = {
        id: saved.id,
        sender: "company" as const,
        text: saved.body,
        time: "Ahora",
      };
      setChatMessages((current) => ({
        ...current,
        [selectedConversationId]: [
          ...(current[selectedConversationId] ?? []),
          mapped,
        ],
      }));
      setConversationRecords((current) =>
        current.map((item) =>
          item.id === selectedConversationId
            ? { ...item, preview: text, time: "Ahora" }
            : item,
        ),
      );
      form.reset();
    } catch (error) {
      showToast(
        error instanceof ApiError && error.status >= 500
          ? "El servicio no está disponible. Inténtalo nuevamente."
          : "No se pudo enviar el mensaje. Revisa la conversación e inténtalo nuevamente.",
      );
    }
  }

  async function removeShift() {
    if (!session || !selectedShift) return;
    const reason = window
      .prompt(`Motivo para cancelar ${selectedShift.role}`)
      ?.trim();
    if (!reason) return;
    try {
      const saved = await businessApi.shifts.cancel(
        session.token,
        selectedShift.id,
        reason,
      );
      const mapped = mapShift(saved);
      setShifts((current) =>
        current.map((item) => (item.id === mapped.id ? mapped : item)),
      );
      showToast("Turno cancelado y registrado.");
    } catch {
      showToast("No se pudo cancelar el turno.");
    }
  }
  async function toggleRescue(shiftId?: string) {
    if (!session) return;
    const target =
      shifts.find((shift) => shift.id === (shiftId ?? selectedShiftId)) ??
      selectedShift;
    if (!target) return;
    try {
      const saved = await businessApi.shifts.update(session.token, target.id, {
        rescueActive: true,
      });
      const mapped = mapShift(saved);
      setShifts((current) =>
        current.map((item) => (item.id === mapped.id ? mapped : item)),
      );
      setSelectedShiftId(target.id);
      setRescueActive(true);
      showToast("CUMPLE Rescate activado.");
    } catch {
      showToast("No se pudo activar el rescate.");
    }
  }
  async function decideApplication(
    applicationId: string,
    decision: "ACCEPTED" | "REJECTED",
  ) {
    if (!session || !selectedShift) return;
    let reason: string | undefined;
    if (decision === "REJECTED") {
      const entered = window.prompt(
        "Indica un motivo breve para cerrar esta postulación:",
      );
      if (entered === null) return;
      reason = entered.trim();
      if (reason.length < 3) {
        showToast("El motivo debe tener al menos 3 caracteres.");
        return;
      }
    }
    try {
      await businessApi.applications.decide(
        session.token,
        selectedShift.id,
        applicationId,
        decision,
        reason,
      );
      const [updatedShift, applications, pending] = await Promise.all([
        businessApi.shifts.get(session.token, selectedShift.id),
        businessApi.applications.list(session.token, selectedShift.id),
        businessApi.applications.pending(session.token),
      ]);
      const mapped = mapShift(updatedShift);
      setShifts((current) =>
        current.map((item) => (item.id === mapped.id ? mapped : item)),
      );
      setShiftApplications(applications);
      setPendingApplications(pending);
      showToast(
        decision === "ACCEPTED"
          ? "Postulación aceptada y turno asignado."
          : "Postulación rechazada.",
      );
    } catch (error) {
      showToast(
        error instanceof ApiError && error.code === "SHIFT_FULL"
          ? "El turno ya alcanzó su capacidad."
          : "No pudimos actualizar la postulación.",
      );
    }
  }
  function openCrud(kind: Exclude<ModalKind, null>, id: string | null = null) {
    setEditingId(id);
    setModalKind(kind);
  }
  async function saveCrud(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !modalKind) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    try {
      if (modalKind === "company") {
        const saved = await businessApi.company.update(session.token, {
          name: String(data.get("name")),
          legalName: String(data.get("legalName")) || null,
          industry: String(data.get("industry")) || null,
          phone: String(data.get("phone")) || null,
          address: String(data.get("address")) || null,
          district: String(data.get("district")) || null,
        });
        setCompany(saved);
      }
      if (modalKind === "worker") {
        const input = {
          name: String(data.get("name")),
          role: String(data.get("role")),
          email: String(data.get("email")) || null,
          phone: String(data.get("phone")) || null,
          skills: String(data.get("skills"))
            .split(",")
            .map((skill) => skill.trim())
            .filter(Boolean),
          availability: String(data.get("availability")) || null,
          status: String(data.get("status")),
        };
        const saved = editingId
          ? await businessApi.workers.update(session.token, editingId, input)
          : await businessApi.workers.create(session.token, input);
        const mapped = mapWorker(saved);
        setWorkerRecords((current) =>
          editingId
            ? current.map((item) => (item.id === mapped.id ? mapped : item))
            : [...current, mapped],
        );
      }
      if (modalKind === "payment") {
        const input = {
          reference: String(data.get("reference")),
          description: String(data.get("description")),
          amountCents: Math.round(Number(data.get("amount")) * 100),
          workerCount: Number(data.get("workerCount") || 0),
          status: String(data.get("status")),
          dueAt: data.get("dueAt")
            ? new Date(String(data.get("dueAt"))).toISOString()
            : null,
        };
        const saved = editingId
          ? await businessApi.payments.update(session.token, editingId, input)
          : await businessApi.payments.create(session.token, input);
        const mapped = mapPayment(saved);
        setPaymentRecords((current) =>
          editingId
            ? current.map((item) => (item.id === mapped.id ? mapped : item))
            : [mapped, ...current],
        );
      }
      if (modalKind === "conversation") {
        const input = editingId
          ? {
            subject: String(data.get("subject")),
            status: String(data.get("status")),
          }
          : {
            subject: String(data.get("subject")),
            workerId: String(data.get("workerId")),
            shiftId: String(data.get("shiftId")) || null,
          };
        const saved = editingId
          ? await businessApi.conversations.update(
            session.token,
            editingId,
            input,
          )
          : await businessApi.conversations.create(session.token, input);
        const full = await businessApi.conversations.get(
          session.token,
          saved.id,
        );
        const mapped = mapConversation(full);
        setConversationRecords((current) =>
          editingId
            ? current.map((item) => (item.id === mapped.id ? mapped : item))
            : [mapped, ...current],
        );
        setChatMessages((current) => ({
          ...current,
          [mapped.id]: mapMessages(full),
        }));
        setSelectedConversation(mapped.id);
      }
      setModalKind(null);
      setEditingId(null);
      showToast("Cambios guardados correctamente.");
    } catch (error) {
      showToast(
        error instanceof ApiError && error.code === "DUPLICATE_RECORD"
          ? "Ya existe un registro con esos datos."
          : "No se pudieron guardar los cambios.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function removeWorker(id: string) {
    if (
      !session ||
      !window.confirm("¿Eliminar este trabajador y sus conversaciones?")
    )
      return;
    try {
      await businessApi.workers.remove(session.token, id);
      setWorkerRecords((current) => current.filter((item) => item.id !== id));
      setConversationRecords((current) =>
        current.filter((item) => item.workerId !== id),
      );
      showToast("Trabajador eliminado.");
    } catch {
      showToast("No se pudo eliminar el trabajador.");
    }
  }
  async function removePayment(id: string) {
    if (!session || !window.confirm("¿Eliminar este movimiento?")) return;
    try {
      await businessApi.payments.remove(session.token, id);
      setPaymentRecords((current) => current.filter((item) => item.id !== id));
      showToast("Movimiento eliminado.");
    } catch {
      showToast("No se pudo eliminar el movimiento.");
    }
  }
  async function markPaymentProcessed(id: string) {
    if (!session) return;
    const payment = paymentRecords.find((item) => item.id === id);
    if (!payment || payment.rawStatus === "PROCESSED") return;
    if (
      !window.confirm(
        `Confirma que ya pagaste S/ ${payment.amount.toLocaleString("es-PE", { minimumFractionDigits: 2 })} al trabajador.`,
      )
    )
      return;
    try {
      const saved = await businessApi.payments.update(session.token, id, {
        status: "PROCESSED",
      });
      const mapped = mapPayment(saved);
      setPaymentRecords((current) =>
        current.map((item) => (item.id === mapped.id ? mapped : item)),
      );
      showToast("Pago reportado. El trabajador ya puede confirmar la recepción.");
    } catch {
      showToast("No pudimos reportar el pago.");
    }
  }
  async function removeConversation() {
    if (
      !session ||
      !selectedConversation ||
      !window.confirm("¿Eliminar esta conversación y sus mensajes?")
    )
      return;
    try {
      await businessApi.conversations.remove(
        session.token,
        selectedConversation,
      );
      const next = conversationRecords.filter(
        (item) => item.id !== selectedConversation,
      );
      setConversationRecords(next);
      setSelectedConversation(next[0]?.id ?? "");
      showToast("Conversación eliminada.");
    } catch {
      showToast("No se pudo eliminar la conversación.");
    }
  }

  if (authChecking)
    return (
      <div className="app-loading">
        <span className="brand-mark">CN</span>
        <p>Preparando tu panel…</p>
      </div>
    );
  if (!session) return <BusinessAuth onAuthenticated={authenticated} />;

  return (
    <div className="app-shell">
      {mobileMenu && (
        <button
          className="page-scrim"
          aria-label="Cerrar menú"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside
        className={`sidebar${mobileMenu ? " open" : ""}`}
        aria-label="Navegación principal"
      >
        <div className="brand">
          <div className="brand-mark">CN</div>
          <div>
            <div className="brand-name">
              CUMPLE <span>NOW</span>
            </div>
            <div className="brand-caption">Panel para empresas</div>
          </div>
          <button
            className="sidebar-close"
            aria-label="Cerrar menú"
            onClick={() => setMobileMenu(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="nav-label">Operaciones</div>
        <nav className="nav">
          {navigation.map(({ label, icon: Icon }) => {
            const badge =
              label === "Turnos"
                ? pendingApplications.count
                : label === "Mensajes"
                  ? unreadMessages
                  : 0;
            return (
              <button
                className={`nav-item${activeNav === label ? " active" : ""}`}
                aria-current={activeNav === label ? "page" : undefined}
                key={label}
                type="button"
                onClick={() => navigate(label)}
              >
                <Icon size={18} />
                <span>{label}</span>
                {badge > 0 && <span className="nav-badge">{badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="support-card">
          <Sparkles size={17} />
          <div>
            <strong>¿Necesitas ayuda?</strong>
            <span>Habla con soporte</span>
          </div>
          <ArrowUpRight size={15} />
        </div>
        <button
          className="company-card"
          type="button"
          onClick={() => openCrud("company")}
        >
          <span className="company-logo">
            {initials(company?.name ?? session.name)}
          </span>
          <span className="company-copy">
            <strong>{company?.name ?? session.name}</strong>
            <span>
              {subscription?.plan === "PRO" ? "Empresa Pro" : "Plan piloto"}
            </span>
          </span>
          <Pencil size={15} color="#718096" />
        </button>
        <button
          className="logout-button"
          type="button"
          onClick={() => void logout()}
        >
          <LogOut size={15} /> Cerrar sesión
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              type="button"
              aria-label="Abrir menú"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              Empresa / <strong>{activeNav}</strong>
              {dataLoading && (
                <span className="sync-status">Sincronizando…</span>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <label className="period-control">
              <span>Periodo</span>
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                <option>Esta semana</option>
                <option>Este mes</option>
                <option>Últimos 30 días</option>
              </select>
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label="Ver notificaciones"
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell size={18} />
              {pendingApplications.count + unreadMessages > 0 && (
                <span className="notification-dot" />
              )}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate("Trabajadores")}
            >
              <Users size={17} /> Equipo
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setEditingShift(null);
                setPublishOpen(true);
              }}
            >
              <Plus size={18} />
              <span>Publicar turno</span>
            </button>
          </div>
        </header>

        {activeNav === "Resumen" && (
          <Overview
            companyName={company?.name ?? session.name}
            shifts={shifts}
            workers={workerRecords}
            payments={periodPayments}
            period={period}
            pendingApplications={pendingApplications}
            rescueActive={rescueActive}
            onRescue={() => {
              const priority =
                shifts.find((shift) => shift.coverage !== "Completo") ??
                shifts[0];
              if (priority) void toggleRescue(priority.id);
              else showToast("Publica un turno antes de activar el rescate.");
            }}
            onNavigate={navigate}
            onShift={(id) => {
              setSelectedShiftId(id);
              navigate("Turnos");
            }}
          />
        )}

        {activeNav === "Turnos" && (
          <div className="workspace view-workspace">
            <ViewHeader
              eyebrow="Planificación operativa"
              title="Turnos"
              description="Publica, cubre y supervisa tus necesidades de personal desde un solo lugar."
            >
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  showToast("Calendario sincronizado con los turnos actuales.")
                }
              >
                <CalendarCheck2 size={17} /> Calendario
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setEditingShift(null);
                  setPublishOpen(true);
                }}
              >
                <Plus size={17} /> Nuevo turno
              </button>
            </ViewHeader>
            {selectedShift && (
              <section
                id="seleccion-talento"
                className="application-workspace application-workspace-priority"
              >
                <ViewHeader
                  eyebrow="1 · Selección de talento"
                  title={`Postulaciones · ${selectedShift.role}`}
                  description="Revisa primero a los candidatos de este turno y acepta o rechaza cada postulación aquí. Cambia de turno más abajo para revisar otra lista."
                >
                  <span className="application-count" aria-live="polite">
                    {applicationsLoading || !applicationsMatchSelectedShift
                      ? "Actualizando…"
                      : applicationsError
                        ? "No disponibles"
                        : `${shiftApplications.length} ${shiftApplications.length === 1 ? "postulación" : "postulaciones"}`}
                  </span>
                </ViewHeader>
                <div
                  className="panel application-board"
                  aria-busy={
                    applicationsLoading || !applicationsMatchSelectedShift
                  }
                >
                  {applicationsLoading || !applicationsMatchSelectedShift ? (
                    <p className="empty-inline" role="status">
                      Cargando postulaciones…
                    </p>
                  ) : applicationsError ? (
                    <div className="empty-state application-error" role="alert">
                      <AlertTriangle size={24} />
                      <strong>No pudimos cargar las postulaciones</strong>
                      <span>{applicationsError}</span>
                    </div>
                  ) : shiftApplications.length === 0 ? (
                    <div className="empty-state">
                      <Users size={24} />
                      <strong>Aún no hay postulaciones</strong>
                      <span>
                        Cuando un trabajador se postule, aparecerá aquí en
                        tiempo real.
                      </span>
                    </div>
                  ) : (
                    shiftApplications.map((application) => (
                      <div
                        className="application-row application-row-with-answers"
                        key={application.id}
                      >
                        <span className="conversation-avatar">
                          {initials(application.worker.name)}
                        </span>
                        <div className="application-copy">
                          <strong>{application.worker.name}</strong>
                          <small>
                            {application.worker.email ??
                              application.worker.identifier}
                          </small>
                          <small
                            className={`next-action ${application.nextAction.actor.toLowerCase()}`}
                          >
                            {application.nextAction.label}
                          </small>
                          {(application.screeningAnswers ?? []).length > 0 && (
                            <dl className="screening-answers">
                              {(application.screeningAnswers ?? []).map(
                                (item) => (
                                  <div key={item.question}>
                                    <dt>{item.question}</dt>
                                    <dd>{item.answer}</dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          )}
                        </div>
                        <span
                          className={`application-status ${application.status.toLowerCase()}`}
                        >
                          {application.status === "PENDING"
                            ? "Pendiente"
                            : application.status === "ACCEPTED"
                              ? "Aceptada"
                              : "Rechazada"}
                        </span>
                        {application.status === "PENDING" && (
                          <span className="inline-actions">
                            <button
                              className="row-action"
                              type="button"
                              aria-label={`Aceptar a ${application.worker.name}`}
                              onClick={() =>
                                void decideApplication(
                                  application.id,
                                  "ACCEPTED",
                                )
                              }
                            >
                              <Check size={15} />
                            </button>
                            <button
                              className="row-action danger"
                              type="button"
                              aria-label={`Rechazar a ${application.worker.name}`}
                              onClick={() =>
                                void decideApplication(
                                  application.id,
                                  "REJECTED",
                                )
                              }
                            >
                              <X size={15} />
                            </button>
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
            {pendingApplications.count > 0 && (
              <button
                className="pending-application-banner"
                type="button"
                onClick={() =>
                  setSelectedShiftId(
                    pendingApplications.shiftIds[0] ?? selectedShiftId,
                  )
                }
              >
                <span>
                  <UserPlus size={19} />
                </span>
                <strong>
                  {pendingApplications.count === 1
                    ? "1 postulación pendiente de revisión"
                    : `${pendingApplications.count} postulaciones pendientes de revisión`}
                </strong>
                <small>
                  Revisa los candidatos y decide quién continúa en el turno.
                </small>
                <ArrowUpRight size={17} />
              </button>
            )}
            <section className="view-stat-grid">
              <MiniStat
                label="Publicados"
                value={String(shifts.length)}
                detail={`${shifts.filter((shift) => shift.status === "PUBLISHED" && !isShiftExpired(shift)).length} activos`}
                icon={CalendarDays}
              />
              <MiniStat
                label="Por cubrir"
                value={String(
                  shifts.filter((shift) => shift.coverage !== "Completo")
                    .length,
                )}
                detail="Requieren atención"
                icon={AlertTriangle}
                warning
              />
              <MiniStat
                label="Confirmaciones"
                value={`${shifts.reduce((sum, shift) => sum + shift.confirmed, 0)}/${shifts.reduce((sum, shift) => sum + shift.required, 0)}`}
                detail="Cobertura acumulada"
                icon={UserCheck}
              />
              <MiniStat
                label="Costo estimado"
                value={`S/ ${shifts.reduce((sum, shift) => sum + shift.pay * shift.required, 0).toLocaleString("es-PE")}`}
                detail="Personal requerido"
                icon={CircleDollarSign}
              />
            </section>
            <section className="management-grid">
              <article className="panel management-list">
                <div className="management-toolbar">
                  <label className="search-control">
                    <Search size={16} />
                    <input
                      aria-label="Buscar turnos"
                      placeholder="Buscar por rol, sede o fecha"
                      value={shiftSearch}
                      onChange={(event) => setShiftSearch(event.target.value)}
                    />
                  </label>
                  <div className="filter-tabs">
                    {(["Todos", "Por cubrir", "Completos"] as const).map(
                      (filter) => (
                        <button
                          className={shiftFilter === filter ? "active" : ""}
                          key={filter}
                          type="button"
                          onClick={() => setShiftFilter(filter)}
                        >
                          {filter}
                        </button>
                      ),
                    )}
                  </div>
                  <button
                    className="compact-button"
                    type="button"
                    onClick={() =>
                      showToast("Filtros ordenados por fecha más próxima.")
                    }
                  >
                    <Filter size={15} /> Más filtros
                  </button>
                </div>
                <div className="managed-shifts">
                  {filteredShifts.map((shift) => (
                    <ManagedShift
                      key={shift.id}
                      shift={shift}
                      selected={selectedShift?.id === shift.id}
                      onSelect={() => setSelectedShiftId(shift.id)}
                    />
                  ))}
                  {filteredShifts.length === 0 && (
                    <div className="empty-state">
                      <Search size={24} />
                      <strong>No encontramos turnos</strong>
                      <span>Ajusta la búsqueda o cambia el filtro.</span>
                    </div>
                  )}
                </div>
              </article>
              {selectedShift && (
                <aside className="panel detail-panel">
                  <div className="detail-top">
                    <span
                      className={`coverage-badge ${coverageClass(selectedShift.coverage)}`}
                    >
                      {selectedShift.coverage}
                    </span>
                    {isShiftExpired(selectedShift) && (
                      <span className="expired-badge">Vencido</span>
                    )}
                    <span className="inline-actions">
                      <button
                        className="row-action"
                        type="button"
                        aria-label="Editar turno"
                        disabled={isShiftExpired(selectedShift)}
                        title={
                          isShiftExpired(selectedShift)
                            ? "Este turno ya venció y no se puede editar."
                            : undefined
                        }
                        onClick={() => {
                          setEditingShift(selectedShift);
                          setPublishOpen(true);
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="row-action danger"
                        type="button"
                        aria-label="Eliminar turno"
                        onClick={() => void removeShift()}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </div>
                  <div className="detail-icon">
                    <BriefcaseBusiness size={22} />
                  </div>
                  <p className="eyebrow">Detalle del turno</p>
                  <h2>{selectedShift.role}</h2>
                  <div className="detail-facts">
                    <span>
                      <CalendarDays size={16} />
                      <i>
                        <small>Fecha</small>
                        <strong>{selectedShift.date}</strong>
                      </i>
                    </span>
                    <span>
                      <Clock3 size={16} />
                      <i>
                        <small>Horario</small>
                        <strong>{selectedShift.schedule}</strong>
                      </i>
                    </span>
                    <span>
                      <MapPin size={16} />
                      <i>
                        <small>Sede</small>
                        <strong>{selectedShift.location}</strong>
                      </i>
                    </span>
                  </div>
                  <div className="detail-progress">
                    <div>
                      <span>Cobertura</span>
                      <strong>
                        {selectedShift.confirmed} de {selectedShift.required}
                      </strong>
                    </div>
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${Math.round((selectedShift.confirmed / selectedShift.required) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="detail-cost">
                    <span>Inversión estimada</span>
                    <strong>
                      S/ {selectedShift.pay * selectedShift.required}
                    </strong>
                    <small>S/ {selectedShift.pay} por persona</small>
                  </div>
                  <button
                    className="primary-button full-action"
                    type="button"
                    disabled={selectedShift.rescueActive}
                    onClick={() => void toggleRescue()}
                  >
                    <Bolt size={17} />{" "}
                    {selectedShift.rescueActive
                      ? "Rescate activado"
                      : selectedShift.coverage === "Completo"
                        ? "Ver equipo asignado"
                        : "Acelerar cobertura"}
                  </button>
                  <button
                    className="secondary-button full-action"
                    type="button"
                    disabled={isShiftExpired(selectedShift)}
                    title={
                      isShiftExpired(selectedShift)
                        ? "Este turno ya venció y no se puede editar."
                        : undefined
                    }
                    onClick={() => {
                      setEditingShift(selectedShift);
                      setPublishOpen(true);
                    }}
                  >
                    <FileText size={16} />{" "}
                    {isShiftExpired(selectedShift)
                      ? "Turno vencido: no se puede editar"
                      : "Editar información"}
                  </button>
                </aside>
              )}
            </section>
          </div>
        )}

        {activeNav === "Trabajadores" && (
          <div className="workspace view-workspace">
            <ViewHeader
              eyebrow="Red de talento"
              title="Trabajadores"
              description="Encuentra perfiles visibles, revisa sus especialidades y forma tu equipo frecuente."
            >
              <button
                className="primary-button"
                type="button"
                onClick={() => openCrud("worker")}
              >
                <UserPlus size={17} /> Agregar trabajador
              </button>
            </ViewHeader>
            <section className="talent-summary">
              <article className="talent-highlight">
                <span className="talent-highlight-icon">
                  <BadgeCheck size={23} />
                </span>
                <div>
                  <p>Equipo frecuente</p>
                  <strong>{workerRecords.length} trabajadores</strong>
                  <small>
                    Contactos operativos de esta empresa
                  </small>
                </div>
                <div className="talent-avatars">
                  {workerRecords.slice(0, 4).map((worker) => (
                    <i key={worker.id}>{worker.initials}</i>
                  ))}
                </div>
              </article>
              <MiniStat
                label="Disponibles hoy"
                value={String(
                  workerRecords.filter(
                    (worker) => worker.status === "Disponible",
                  ).length,
                )}
                detail="Listos para asignar"
                icon={UserCheck}
              />
              <MiniStat
                label="Contactos registrados"
                value={String(workerRecords.length)}
                detail="Historial de empresa"
                icon={Users}
              />
            </section>
            <section className="panel directory-panel">
              <div className="directory-header">
                <div>
                  <h2>Talento disponible</h2>
                  <p>Perfiles profesionales de la plataforma, con datos declarados por cada trabajador. No son contactos de tu empresa.</p>
                </div>
              </div>
              <div className="management-toolbar">
                <label className="search-control">
                  <Search size={16} />
                  <input
                    aria-label="Buscar talento por nombre, presentación o distrito"
                    placeholder="Buscar por nombre, presentación o distrito"
                    value={talentQueryInput}
                    onChange={(event) => setTalentQueryInput(event.target.value)}
                  />
                </label>
                <input
                  aria-label="Filtrar talento por distrito"
                  placeholder="Distrito"
                  value={talentDistrictInput}
                  onChange={(event) => setTalentDistrictInput(event.target.value)}
                />
                <select aria-label="Filtrar talento por especialidad" value={talentSpecialty} onChange={(event) => setTalentSpecialty(event.target.value)}>
                  <option value="">Todas las especialidades</option>
                  {talentSpecialties.map((specialty) => <option key={specialty.id} value={specialty.id}>{specialty.name}</option>)}
                </select>
                <div className="filter-tabs">
                  <button
                    type="button"
                    className={talentAvailableOnly ? "active" : ""}
                    aria-pressed={talentAvailableOnly}
                    onClick={() => setTalentAvailableOnly((current) => !current)}
                  >
                    Solo disponibles ahora
                  </button>
                </div>
              </div>
              <div className="worker-directory" aria-live="polite">
                {talentLoading && <span className="muted">Buscando talento disponible…</span>}
                {!talentLoading && talent.map((profile) => {
                  const alreadyInvited = activelyInvitedProfileIds.has(profile.id);
                  const sendingInvite = invitingProfileId === profile.id;
                  const inviteError = inviteErrors[profile.id];
                  return (
                    <article className="directory-card" key={profile.id}>
                      <div className="directory-identity"><strong>{profile.name}</strong><span>{profile.headline ?? "Perfil profesional en actualización"}</span></div>
                      <p>{profile.district ?? "Distrito no indicado"} · {profile.isAvailable ? (profile.availabilityText ?? "Disponible") : "No disponible"}</p>
                      <div className="skill-row">{profile.specialties.map((specialty) => <span key={specialty.id}>{specialty.name}</span>)}</div>
                      <p className="muted">{profile.reputation.reviewCount > 0 ? `${profile.reputation.averageRating?.toFixed(1)} / 5 · ${profile.reputation.reviewCount} reseña${profile.reputation.reviewCount === 1 ? "" : "s"}` : "Aún no tiene reseñas"}</p>
                      <div className="directory-card-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={sendingInvite || alreadyInvited || invitingProfileId !== null}
                          onClick={() => void inviteTalent(profile.id)}
                        >
                          <Mail size={16} />
                          {sendingInvite ? "Enviando…" : alreadyInvited ? "Invitación enviada" : "Invitar"}
                        </button>
                        {inviteError && <span className="invite-error">{inviteError}</span>}
                      </div>
                    </article>
                  );
                })}
                {!talentLoading && talentError && talent.length === 0 && (
                  <div className="empty-state directory-empty">
                    <AlertTriangle size={24} />
                    <strong>No se pudo cargar el talento</strong>
                    <span>{talentError}</span>
                  </div>
                )}
                {!talentLoading && !talentError && talent.length === 0 && (
                  <div className="empty-state directory-empty">
                    <Search size={24} />
                    <strong>Sin datos de talento con estos criterios</strong>
                    <span>Ajusta la especialidad, el distrito, el texto de búsqueda o la disponibilidad.</span>
                  </div>
                )}
                {!talentLoading && talentNextCursor && <button className="secondary-button" type="button" disabled={talentLoadingMore} onClick={() => void loadMoreTalent()}>{talentLoadingMore ? "Cargando…" : "Ver más perfiles"}</button>}
                {!talentLoading && talent.length > 0 && talentError && <p className="muted">{talentError}</p>}
              </div>
            </section>
            <section className="panel directory-panel invitations-panel">
              <div className="directory-header">
                <div>
                  <h2>Invitaciones enviadas</h2>
                  <p>Seguimiento de las invitaciones que tu empresa envió al talento disponible, con su estado real.</p>
                </div>
              </div>
              <div className="worker-directory invitation-list" aria-live="polite">
                {/* Only the first load (no invitations known yet) shows the full-panel
                    loading/empty/error states. A reload while invitations are already on
                    screen (e.g. leaving and re-entering "Trabajadores") must not hide them
                    behind a spinner; it keeps the list and adds a subtle inline notice. */}
                {invitationsLoading && sentInvitations.length === 0 && (
                  <span className="muted">Cargando invitaciones enviadas…</span>
                )}
                {!invitationsLoading && invitationsError && sentInvitations.length === 0 && (
                  <div className="empty-state directory-empty">
                    <AlertTriangle size={24} />
                    <strong>No se pudieron cargar las invitaciones</strong>
                    <span>{invitationsError}</span>
                  </div>
                )}
                {!invitationsLoading && !invitationsError && sentInvitations.length === 0 && (
                  <div className="empty-state directory-empty">
                    <Mail size={24} />
                    <strong>Aún no enviaste invitaciones</strong>
                    <span>Invita a un perfil desde "Talento disponible" para verlo aquí.</span>
                  </div>
                )}
                {sentInvitations.map((invitation) => (
                  <article className="directory-card invitation-card" key={invitation.id}>
                    <div className="directory-identity">
                      <strong>{invitation.workerName}</strong>
                      <span
                        className={`invitation-status invitation-status-${invitation.status.toLowerCase()}`}
                      >
                        {INVITATION_STATUS_LABEL[invitation.status]}
                      </span>
                    </div>
                    {invitation.shift && <p>Turno: {invitation.shift.title}</p>}
                    {invitation.message && <p className="muted">{invitation.message}</p>}
                    <p className="muted">
                      Enviada el {new Date(invitation.createdAt).toLocaleDateString("es-PE")}
                      {invitation.status === "PENDING"
                        ? ` · vence el ${new Date(invitation.expiresAt).toLocaleDateString("es-PE")}`
                        : ""}
                    </p>
                  </article>
                ))}
                {invitationsLoading && sentInvitations.length > 0 && (
                  <span className="muted">Actualizando invitaciones…</span>
                )}
                {!invitationsLoading && invitationsError && sentInvitations.length > 0 && (
                  <p className="muted">{invitationsError}</p>
                )}
              </div>
            </section>
            <section className="panel directory-panel">
              <div className="directory-header">
                <div>
                  <h2>Equipo / contactos</h2>
                  <p>Contactos operativos que tu empresa ya registró, con su estado dentro de esta cuenta.</p>
                </div>
              </div>
              <div className="management-toolbar">
                <label className="search-control">
                  <Search size={16} />
                  <input
                    aria-label="Buscar en tu equipo"
                    placeholder="Buscar en tu equipo por nombre, rol o habilidad"
                    value={workerSearch}
                    onChange={(event) => setWorkerSearch(event.target.value)}
                  />
                </label>
                <div className="filter-tabs">
                  {(["Todos", "Disponibles", "En turno"] as const).map(
                    (filter) => (
                      <button
                        className={workerFilter === filter ? "active" : ""}
                        key={filter}
                        type="button"
                        onClick={() => setWorkerFilter(filter)}
                      >
                        {filter}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="worker-directory">
                {filteredWorkers.map((worker) => (
                  <WorkerDirectoryCard
                    key={worker.id}
                    worker={worker}
                    onMessage={() => {
                      const conversation = conversationRecords.find(
                        (item) => item.workerId === worker.id,
                      );
                      if (conversation) {
                        setSelectedConversation(conversation.id);
                        navigate("Mensajes");
                      } else {
                        openCrud("conversation");
                      }
                    }}
                    onEdit={() => openCrud("worker", worker.id)}
                    onDelete={() => void removeWorker(worker.id)}
                  />
                ))}
                {filteredWorkers.length === 0 && (
                  <div className="empty-state directory-empty">
                    <Search size={24} />
                    <strong>No hay perfiles con estos criterios</strong>
                    <span>Agrega un trabajador o cambia los filtros.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {activeNav === "Mensajes" && (
          <div className="workspace view-workspace messages-workspace">
            <ViewHeader
              eyebrow="Comunicación centralizada"
              title="Mensajes"
              description="Coordina ingresos, indicaciones y cambios sin salir del panel."
            >
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  showToast(
                    "Los mensajes se marcan al abrir cada conversación.",
                  )
                }
              >
                <CheckCheck size={17} /> Estado de lectura
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!workerRecords.length}
                onClick={() => openCrud("conversation")}
              >
                <Plus size={17} /> Nueva conversación
              </button>
            </ViewHeader>
            <section className="messages-shell">
              <aside className="conversation-panel">
                <div className="conversation-header">
                  <div>
                    <h2>Conversaciones</h2>
                    <span>
                      {conversationRecords.reduce(
                        (sum, item) => sum + item.unread,
                        0,
                      )}{" "}
                      sin leer
                    </span>
                  </div>
                  <label className="search-control">
                    <Search size={15} />
                    <input
                      aria-label="Buscar conversaciones"
                      placeholder="Buscar conversación"
                      value={messageSearch}
                      onChange={(event) => setMessageSearch(event.target.value)}
                    />
                  </label>
                </div>
                <div className="conversation-list">
                  {filteredConversations.map((conversation) => (
                    <button
                      className={`conversation-item${selectedConversation === conversation.id ? " active" : ""}`}
                      type="button"
                      key={conversation.id}
                      onClick={() => setSelectedConversation(conversation.id)}
                    >
                      <span className="conversation-avatar">
                        {conversation.initials}
                        {conversation.online && <i />}
                      </span>
                      <span className="conversation-copy">
                        <span>
                          <strong>{conversation.name}</strong>
                          <time>{conversation.time}</time>
                        </span>
                        <small>{conversation.role}</small>
                        <p>{conversation.preview}</p>
                      </span>
                      {conversation.unread > 0 && <b>{conversation.unread}</b>}
                    </button>
                  ))}
                  {filteredConversations.length === 0 && (
                    <div className="empty-state">
                      <Search size={23} />
                      <strong>Sin conversaciones</strong>
                      <span>Agrega talento e inicia una conversación.</span>
                    </div>
                  )}
                </div>
              </aside>
              {selectedConversationData ? (
                <article className="chat-panel">
                  <header className="chat-header">
                    <div className="conversation-avatar large">
                      {selectedConversationData.initials}
                      {selectedConversationData.online && <i />}
                    </div>
                    <div>
                      <h2>{selectedConversationData.name}</h2>
                      <p>{selectedConversationData.subject}</p>
                    </div>
                    <span className="inline-actions">
                      <button
                        className="row-action"
                        type="button"
                        aria-label="Editar conversación"
                        onClick={() =>
                          openCrud("conversation", selectedConversationData.id)
                        }
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="row-action danger"
                        type="button"
                        aria-label="Eliminar conversación"
                        onClick={() => void removeConversation()}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </header>
                  <div className="shift-context">
                    <CalendarCheck2 size={17} />
                    <span>
                      <small>Conversación sobre</small>
                      <strong>{selectedConversationData.subject}</strong>
                    </span>
                    {selectedConversationData.shiftId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedShiftId(
                            selectedConversationData.shiftId ?? "",
                          );
                          navigate("Turnos");
                        }}
                      >
                        Ver turno
                      </button>
                    )}
                  </div>
                  <div className="chat-thread">
                    <div className="day-divider">
                      <span>Mensajes</span>
                    </div>
                    {(chatMessages[selectedConversation] ?? []).map(
                      (message) => (
                        <div
                          className={`message-bubble ${message.sender}`}
                          key={message.id}
                        >
                          <p>{message.text}</p>
                          <small>
                            {message.time}
                            {message.sender === "company" && (
                              <CheckCheck size={12} />
                            )}
                          </small>
                        </div>
                      ),
                    )}
                    {!(chatMessages[selectedConversation] ?? []).length && (
                      <div className="empty-state">
                        <MessageSquareText size={23} />
                        <strong>Inicia la coordinación</strong>
                        <span>Envía la primera indicación.</span>
                      </div>
                    )}
                  </div>
                  <form className="message-composer" onSubmit={sendMessage}>
                    <button
                      type="button"
                      aria-label="Adjuntar archivo"
                      onClick={() =>
                        showToast(
                          "La carga de archivos se habilitará con almacenamiento de documentos.",
                        )
                      }
                    >
                      <Paperclip size={18} />
                    </button>
                    <input
                      name="message"
                      autoComplete="off"
                      aria-label="Escribir mensaje"
                      placeholder="Escribe una indicación para el trabajador…"
                    />
                    <button
                      className="send-button"
                      type="submit"
                      aria-label="Enviar mensaje"
                    >
                      <Send size={17} />
                    </button>
                  </form>
                </article>
              ) : (
                <article className="chat-panel chat-empty">
                  <MessageSquareText size={34} />
                  <h2>Selecciona una conversación</h2>
                  <p>O crea una nueva para coordinar con tu equipo.</p>
                </article>
              )}
            </section>
          </div>
        )}

        {activeNav === "Pagos" && (
          <div className="workspace view-workspace">
            <ViewHeader
              eyebrow="Seguimiento operativo"
              title="Pagos"
              description="Registra los pagos directos a tus trabajadores y conserva sus referencias."
            >
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  showToast("El reporte refleja los movimientos persistidos.")
                }
              >
                <Download size={17} /> Exportar
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => openCrud("payment")}
              >
                <Plus size={17} /> Registrar pago
              </button>
            </ViewHeader>
            <section className="finance-overview">
              <article className="balance-card">
                <div className="balance-head">
                  <span>Total registrado</span>
                  <ShieldCheck size={18} />
                </div>
                <strong>
                  S/{" "}
                  {paymentRecords
                    .reduce((sum, item) => sum + item.amount, 0)
                    .toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                </strong>
                <p>Pagos directos asociados a turnos completados.</p>
                <div>
                  <span>
                    <small>Comprometido</small>
                    <b>
                      S/{" "}
                      {paymentRecords
                        .filter((item) => item.rawStatus !== "PROCESSED")
                        .reduce((sum, item) => sum + item.amount, 0)
                        .toLocaleString("es-PE")}
                    </b>
                  </span>
                  <span>
                    <small>Reportado</small>
                    <b>
                      S/{" "}
                      {paymentRecords
                        .filter((item) => item.rawStatus === "PROCESSED")
                        .reduce((sum, item) => sum + item.amount, 0)
                        .toLocaleString("es-PE")}
                    </b>
                  </span>
                </div>
              </article>
              <MiniStat
                label="Reportado"
                value={`S/ ${paymentRecords
                  .filter((item) => item.rawStatus === "PROCESSED")
                  .reduce((sum, item) => sum + item.amount, 0)
                  .toLocaleString("es-PE")}`}
                detail="Pagos reportados"
                icon={TrendingUp}
              />
              <MiniStat
                label="Pendiente de reporte"
                value={`S/ ${paymentRecords
                  .filter((item) => item.rawStatus === "PENDING")
                  .reduce((sum, item) => sum + item.amount, 0)
                  .toLocaleString("es-PE")}`}
                detail={`${paymentRecords.filter((item) => item.rawStatus === "PENDING").length} pagos pendientes`}
                icon={Clock3}
                warning
              />
              <MiniStat
                label="Programado"
                value={String(
                  paymentRecords.filter(
                    (item) => item.rawStatus === "SCHEDULED",
                  ).length,
                )}
                detail="Próximos desembolsos"
                icon={ReceiptText}
              />
            </section>
            <section className="payment-content-grid">
              <article className="panel transaction-panel">
                <div className="directory-header">
                  <div>
                    <h2>Pagos reportados</h2>
                    <p>Consulta el monto, estado y referencia de cada pago.</p>
                  </div>
                  <button
                    className="compact-button"
                    type="button"
                    onClick={() => showToast("Comprobante consolidado listo.")}
                  >
                    <FileText size={15} /> Comprobantes
                  </button>
                </div>
                <div className="management-toolbar payment-toolbar">
                  <div className="filter-tabs">
                    {(["Todos", "Procesados", "Pendientes"] as const).map(
                      (filter) => (
                        <button
                          className={paymentFilter === filter ? "active" : ""}
                          key={filter}
                          type="button"
                          onClick={() => setPaymentFilter(filter)}
                        >
                          {filter}
                        </button>
                      ),
                    )}
                  </div>
                  <button className="compact-button" type="button">
                    <Filter size={15} /> Fecha
                  </button>
                </div>
                <div className="transaction-table">
                  <div className="transaction-head">
                    <span>Movimiento</span>
                    <span>Trabajadores</span>
                    <span>Estado</span>
                    <span>Monto</span>
                    <span />
                  </div>
                  {filteredTransactions.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      onEdit={() => openCrud("payment", transaction.id)}
                      onDelete={() => void removePayment(transaction.id)}
                      onMarkProcessed={() => void markPaymentProcessed(transaction.id)}
                    />
                  ))}
                  {filteredTransactions.length === 0 && (
                    <div className="empty-state">
                      <WalletCards size={24} />
                      <strong>No hay movimientos de pago</strong>
                      <span>Los pagos pendientes aparecerán aquí al registrar la salida de un turno.</span>
                    </div>
                  )}
                </div>
              </article>
              <aside className="payment-side">
                <article className="panel payout-card">
                  <div className="payout-icon">
                    <Banknote size={21} />
                  </div>
                  <span>Pendiente de reporte</span>
                  <strong>
                    S/{" "}
                    {periodPayments
                      .filter(
                        (item) =>
                          item.status !== "Procesado" &&
                          item.status !== "Cancelado",
                      )
                      .reduce((sum, item) => sum + item.amount, 0)
                      .toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                  </strong>
                  <small>Según pagos aún no reportados del periodo</small>
                  <div className="payout-step">
                    <span>
                      <Check size={13} />
                    </span>
                    <div>
                      <strong>
                        {
                          periodPayments.filter(
                            (item) => item.rawStatus === "PROCESSED",
                          ).length
                        }{" "}
                        pagos reportados
                      </strong>
                      <small>
                        {
                          periodPayments.filter(
                            (item) => item.rawStatus === "PENDING",
                          ).length
                        }{" "}
                        pendientes de reporte
                      </small>
                    </div>
                  </div>
                  <div className="payment-progress">
                    <i />
                  </div>
                  <button
                    className="full-secondary"
                    type="button"
                    onClick={() => setPaymentFilter("Pendientes")}
                  >
                    <CheckCircle2 size={16} /> Ver pendientes
                  </button>
                </article>
                <article className="panel billing-card">
                  <div>
                    <WalletCards size={18} />
                    <span>
                      <strong>Pago directo a trabajadores</strong>
                      <small>
                        Chambeaya no custodia fondos; registra la referencia del pago.
                      </small>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      showToast(
                        "La integración de pagos queda fuera del piloto. Puedes registrar el pago directo desde el turno.",
                      )
                    }
                  >
                    <ArrowUpRight size={15} />
                  </button>
                </article>
              </aside>
            </section>
          </div>
        )}

        {activeNav === "Membresía" && (
          <MembershipView
            subscription={subscription}
            onToast={showToast}
          />
        )}
      </main>

      {publishOpen && (
        <PublishModal
          shift={editingShift}
          saving={saving}
          onClose={() => {
            setPublishOpen(false);
            setEditingShift(null);
          }}
          onSubmit={publishShift}
        />
      )}
      {modalKind && (
        <CrudModal
          kind={modalKind}
          company={company}
          record={modalRecord}
          workers={workerRecords.map((worker) => ({
            id: worker.id,
            label: `${worker.name} · ${worker.role}`,
          }))}
          shifts={shifts.map((shift) => ({
            id: shift.id,
            label: `${shift.role} · ${shift.date}`,
          }))}
          saving={saving}
          onClose={() => {
            setModalKind(null);
            setEditingId(null);
          }}
          onSubmit={saveCrud}
        />
      )}
      {notificationsOpen && (
        <>
          <button
            className="drawer-scrim"
            aria-label="Cerrar notificaciones"
            onClick={() => setNotificationsOpen(false)}
          />
          <aside className="notification-drawer" aria-label="Notificaciones">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">Centro de alertas</p>
                <h2>Notificaciones</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cerrar"
                onClick={() => setNotificationsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            {pendingApplications.count > 0 && (
              <div className="notice important">
                <span>
                  <UserPlus size={18} />
                </span>
                <div>
                  <strong>
                    {pendingApplications.count === 1
                      ? "Nueva postulación pendiente"
                      : `${pendingApplications.count} postulaciones pendientes`}
                  </strong>
                  <p>Hay candidatos esperando tu revisión y aprobación.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setNotificationsOpen(false);
                      setSelectedShiftId(
                        pendingApplications.shiftIds[0] ?? selectedShiftId,
                      );
                      navigate("Turnos");
                    }}
                  >
                    Revisar postulantes
                  </button>
                </div>
              </div>
            )}
            {unreadMessages > 0 && (
              <div className="notice">
                <span>
                  <Send size={18} />
                </span>
                <div>
                  <strong>{unreadMessages} mensajes sin leer</strong>
                  <p>Tu equipo necesita indicaciones para el ingreso.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate("Mensajes");
                    }}
                  >
                    Revisar mensajes
                  </button>
                </div>
              </div>
            )}
            {pendingApplications.count === 0 && unreadMessages === 0 && (
              <div className="empty-state">
                <CheckCircle2 size={24} />
                <strong>No hay alertas pendientes</strong>
                <span>
                  Te avisaremos cuando llegue una nueva postulación o mensaje.
                </span>
              </div>
            )}
          </aside>
        </>
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button aria-label="Cerrar aviso" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function MembershipView({
  subscription,
  onToast,
}: {
  subscription: SubscriptionRecord | null;
  onToast: (message: string) => void;
}) {
  const plan = subscription?.plan ?? "PILOT";
  const status = subscription?.status ?? "INACTIVE";
  const statusLabel =
    status === "INACTIVE"
      ? "Sin plan activo"
      : status === "TRIAL"
        ? "Piloto activo"
        : status === "ACTIVE"
          ? "Activo"
          : status === "PAUSED"
            ? "Pausado"
            : status === "EXPIRED"
              ? "Finalizado"
              : "Cancelado";
  const trialEnd = subscription?.trialEndsAt
    ? new Intl.DateTimeFormat("es-PE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(subscription.trialEndsAt))
    : "por definir";
  const plans = [
    {
      name: "Piloto",
      code: "PILOT",
      eyebrow: "Ahora",
      price: "S/ 0",
      priceDetail: "30 días de validación",
      description:
        "La operación esencial para validar cobertura, asistencia y pagos directos.",
      benefits: [
        "Publicar y cubrir turnos",
        "Postulaciones y mensajes",
        "Registro de llegada y salida",
        "Historial de pagos reportados",
        "Sin tarjeta ni comisión",
      ],
    },
    {
      name: "Empresa Pro",
      code: "PRO",
      eyebrow: "Recomendado",
      price: "S/ 79 / mes",
      priceDetail: "Incluye 15 turnos completados · S/ 4 por turno adicional",
      description:
        "Para negocios que publican cada semana y quieren previsibilidad sin pagar por intentos fallidos.",
      benefits: [
        "Hasta 3 sedes y 5 usuarios",
        "Plantillas y recordatorios",
        "Reemplazos y alertas operativas",
        "Métricas y exportación",
        "Tope mensual sugerido: S/ 249",
      ],
    },
    {
      name: "Custom",
      code: "CUSTOM",
      eyebrow: "Futuro",
      price: "Desde S/ 399 / mes",
      priceDetail: "Incluye 100 turnos completados · tarifa adicional desde S/ 2.50",
      description:
        "Para cadenas con varias sedes, permisos propios e integraciones que requieren acompañamiento.",
      benefits: [
        "Roles y permisos avanzados",
        "Flujos por sede o negocio",
        "Integraciones y reportes",
        "Soporte operativo prioritario",
        "Tope y alcance definidos por contrato",
      ],
    },
  ];

  return (
    <div className="workspace view-workspace">
      <ViewHeader
        eyebrow="Propuesta comercial futura"
        title="Membresías"
        description="Diseñamos beneficios para crecer sin bloquear el flujo principal ni cobrar antes de validar el valor."
      >
        <span className="membership-coming-soon">
          <Sparkles size={15} /> Activación próximamente
        </span>
      </ViewHeader>

      <section className="membership-current panel">
        <div>
          <p className="eyebrow">Tu situación actual</p>
          <h2>Plan {plan === "PILOT" ? "Piloto" : plan === "PRO" ? "Empresa Pro" : "Custom"}</h2>
          <p>
            {statusLabel}. El piloto no requiere tarjeta ni suscripción para
            publicar, seleccionar o reportar pagos.
          </p>
        </div>
        <div className="membership-current-meta">
          <span className="membership-badge">{statusLabel}</span>
          <small>
            {status === "TRIAL"
              ? `Vigente hasta el ${trialEnd}`
              : "Periodo administrado por Chambeaya"}
          </small>
        </div>
      </section>

      <section className="membership-grid" aria-label="Planes propuestos">
        {plans.map((item) => {
          const isCurrent = item.code === plan;
          return (
            <article
              className={`membership-card${isCurrent ? " current" : ""}`}
              key={item.code}
            >
              <div className="membership-card-head">
                <span className="eyebrow">{item.eyebrow}</span>
                {isCurrent && <span className="membership-badge">Actual</span>}
              </div>
              <h2>{item.name}</h2>
              <strong>{item.price}</strong>
              <span className="membership-price-detail">{item.priceDetail}</span>
              <p>{item.description}</p>
              <ul>
                {item.benefits.map((benefit) => (
                  <li key={benefit}>
                    <CheckCircle2 size={16} /> {benefit}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <span className="membership-card-note">Incluido en tu piloto</span>
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    onToast("La activación se habilitará cuando termine el piloto y validemos el beneficio.")
                  }
                >
                  Quiero conocerlo
                </button>
              )}
            </article>
          );
        })}
      </section>

      <section className="membership-pricing panel">
        <div className="membership-pricing-icon">
          <WalletCards size={21} />
        </div>
        <div>
          <h2>Cobro por valor realizado</h2>
          <p>
            La suscripción se cobra a la empresa, nunca al trabajador. El
            componente variable solo cuenta turnos que llegaron a salida
            registrada; no cobramos por publicar, postular, rechazar ni
            cancelar antes del check-in.
          </p>
        </div>
        <div className="membership-pricing-rules">
          <span><Check size={14} /> Precio final visible en soles</span>
          <span><Check size={14} /> Sin custodia de pagos</span>
          <span><Check size={14} /> Tope mensual y cancelación simple</span>
        </div>
      </section>

      <section className="membership-principles panel">
        <div className="membership-principle-icon">
          <ShieldCheck size={21} />
        </div>
        <div>
          <h2>Reglas para activar una membresía</h2>
          <p>
            Primero validaremos recurrencia, ahorro de tiempo y calidad de la
            cobertura con empresas piloto. Hasta entonces, ningún plan bloquea
            turnos, postulaciones, asistencia ni pagos directos.
          </p>
        </div>
        <div className="membership-principle-list">
          <span><Check size={14} /> Precio validado con clientes</span>
          <span><Check size={14} /> Beneficios medibles por plan</span>
          <span><Check size={14} /> Cambio manual desde administración</span>
        </div>
      </section>
    </div>
  );
}

function Overview({
  companyName,
  shifts,
  workers,
  payments,
  period,
  pendingApplications,
  rescueActive,
  onRescue,
  onNavigate,
  onShift,
}: {
  companyName: string;
  shifts: Shift[];
  workers: Worker[];
  payments: Transaction[];
  period: string;
  pendingApplications: PendingApplicationsSummary;
  rescueActive: boolean;
  onRescue: () => void;
  onNavigate: (view: ViewName) => void;
  onShift: (id: string) => void;
}) {
  const priority =
    shifts.find((shift) => shift.coverage !== "Completo") ?? shifts[0];
  const required = shifts.reduce((sum, shift) => sum + shift.required, 0);
  const confirmed = shifts.reduce((sum, shift) => sum + shift.confirmed, 0);
  const pending = payments
    .filter((payment) => payment.rawStatus !== "PROCESSED")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const uncovered = shifts.filter((shift) => shift.coverage !== "Completo");
  const operationalActions = [
    ...(pendingApplications.count > 0
      ? [{
        icon: UserPlus,
        title: pendingApplications.count === 1
          ? "1 postulación por revisar"
          : `${pendingApplications.count} postulaciones por revisar`,
        detail: "Revisa candidatos antes de cubrir el turno.",
        tone: "teal",
        onClick: () => {
          if (pendingApplications.shiftIds[0]) onShift(pendingApplications.shiftIds[0]);
          else onNavigate("Turnos");
        },
      }]
      : []),
    ...(uncovered.length > 0
      ? [{
        icon: CalendarCheck2,
        title: uncovered.length === 1
          ? "1 turno aún necesita cobertura"
          : `${uncovered.length} turnos aún necesitan cobertura`,
        detail: "Consulta el estado de los cupos y las postulaciones.",
        tone: "navy",
        onClick: () => onNavigate("Turnos"),
      }]
      : []),
    ...(pending > 0
      ? [{
        icon: ReceiptText,
        title: "Registros de pago pendientes",
        detail: `S/ ${pending.toLocaleString("es-PE", { minimumFractionDigits: 2 })} por revisar.`,
        tone: "gold",
        onClick: () => onNavigate("Pagos"),
      }]
      : []),
  ];
  return (
    <div className="workspace">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Centro de operaciones</p>
          <h1>Buenos días, {companyName}</h1>
          <p className="welcome-copy">
            Cubre tus turnos y sigue cada paso hasta reportar el pago.
          </p>
        </div>
        <div className="date-chip">
          <CalendarDays size={15} /> {dateFormat.format(new Date())}
        </div>
      </section>
      {pendingApplications.count > 0 && (
        <button
          className="pending-application-banner"
          type="button"
          onClick={() => {
            if (pendingApplications.shiftIds[0])
              onShift(pendingApplications.shiftIds[0]);
            else onNavigate("Turnos");
          }}
        >
          <span>
            <UserPlus size={19} />
          </span>
          <strong>
            {pendingApplications.count === 1
              ? "1 postulación pendiente de revisión"
              : `${pendingApplications.count} postulaciones pendientes de revisión`}
          </strong>
          <small>Revisa los candidatos antes de cubrir el turno.</small>
          <ArrowUpRight size={17} />
        </button>
      )}
      <section className="metric-grid">
        <MetricCard
          label="Turnos activos"
          value={String(
            shifts.filter(
              (shift) =>
                shift.status !== "CANCELLED" &&
                shift.status !== "COMPLETED" &&
                !isShiftExpired(shift),
            ).length,
          )}
          trend={`${shifts.length} registrados`}
          icon={CalendarDays}
        />
        <MetricCard
          label="Cobertura promedio"
          value={
            required ? `${Math.round((confirmed / required) * 100)}%` : "—"
          }
          trend={`${confirmed}/${required}`}
          icon={ShieldCheck}
        />
        <MetricCard
          label="Talento registrado"
          value={String(workers.length)}
          trend={`${workers.filter((worker) => worker.status === "Disponible").length} disponibles`}
          icon={Users}
        />
        <MetricCard
          label="Pagos por reportar"
          value={`S/ ${pending.toLocaleString("es-PE")}`}
          trend={period}
          icon={CircleDollarSign}
          gold
        />
      </section>
      <section className="panel flow-guide" aria-labelledby="flow-guide-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ruta del turno</p>
            <h2 id="flow-guide-title">Cuatro pasos para cerrar una necesidad</h2>
            <p>La misma secuencia se repite en cada turno.</p>
          </div>
        </div>
        <ol className="flow-guide-list">
          <li>
            <button className="flow-guide-step" type="button" onClick={() => onNavigate("Turnos")}>
              <span>1</span>
              <div>
                <strong>Publica</strong>
                <small>Define horario, sede, cupos y pago.</small>
              </div>
            </button>
          </li>
          <li>
            <button className="flow-guide-step" type="button" onClick={() => onNavigate("Turnos")}>
              <span>2</span>
              <div>
                <strong>Elige</strong>
                <small>Revisa postulantes y acepta a tu equipo.</small>
              </div>
            </button>
          </li>
          <li>
            <button className="flow-guide-step" type="button" onClick={() => onNavigate("Turnos")}>
              <span>3</span>
              <div>
                <strong>Valida</strong>
                <small>Confirma llegada, salida e incidencias.</small>
              </div>
            </button>
          </li>
          <li>
            <button className="flow-guide-step" type="button" onClick={() => onNavigate("Pagos")}>
              <span>4</span>
              <div>
                <strong>Reporta</strong>
                <small>Registra el pago directo y su referencia.</small>
              </div>
            </button>
          </li>
        </ol>
      </section>
      <section className="priority-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Turno prioritario</h2>
              <p>Monitorea la cobertura antes de iniciar la operación.</p>
            </div>
            {priority && (
              <span
                className={
                  priority.rescueActive ? "status-pill resolved" : "status-pill"
                }
              >
                {priority.rescueActive ? "Rescate activo" : priority.coverage}
              </span>
            )}
          </div>
          {priority ? (
            <button
              className="shift-feature overview-shift"
              type="button"
              onClick={() => onShift(priority.id)}
            >
              <div>
                <div className="shift-title-row">
                  <span className="urgent-dot" />
                  <h3>{priority.role}</h3>
                </div>
                <div className="shift-meta">
                  <span>
                    <Clock3 size={14} /> {priority.schedule}
                  </span>
                  <span>
                    <MapPin size={14} /> {priority.location}
                  </span>
                </div>
                <div className="coverage">
                  <div className="coverage-copy">
                    <span>Cobertura confirmada</span>
                    <strong>
                      {priority.confirmed} de {priority.required}
                    </strong>
                  </div>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${priority.required ? Math.round((priority.confirmed / priority.required) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="shift-pay">
                <span>Pago por persona</span>
                <strong>S/ {priority.pay}</strong>
                <small>{priority.date}</small>
              </div>
            </button>
          ) : (
            <div className="empty-state">
              <CalendarDays size={24} />
              <strong>Aún no hay turnos</strong>
              <span>Publica el primero desde la vista de Turnos.</span>
            </div>
          )}
        </article>
        <article
          className={`panel rescue-panel${rescueActive ? " active" : ""}`}
        >
          <div className="rescue-icon">
            {rescueActive ? (
              <CheckCircle2 size={21} />
            ) : (
              <Bolt size={21} fill="currentColor" />
            )}
          </div>
          <h2>{rescueActive ? "Reemplazo en curso" : "¿Faltó alguien?"}</h2>
          <p>
            Esta es una ayuda para excepciones. Busca un reemplazo solo cuando
            una persona cancele o no se presente.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={rescueActive || !priority}
            onClick={onRescue}
          >
            <BriefcaseBusiness size={17} />{" "}
            {rescueActive ? "Búsqueda activada" : "Buscar reemplazo"}
          </button>
        </article>
      </section>
      <section className="operations-grid">
        <article className="panel shifts-panel">
          <div className="panel-heading table-heading">
            <div>
              <h2>Próximos turnos</h2>
              <p>Información persistida de tu operación.</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => onNavigate("Turnos")}
            >
              Gestionar turnos <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="shift-table">
            {shifts.slice(0, 4).map((shift) => (
              <ShiftRow
                key={shift.id}
                shift={shift}
                onSelect={() => onShift(shift.id)}
              />
            ))}
            {!shifts.length && (
              <div className="empty-state">
                <CalendarDays size={24} />
                <strong>Sin turnos registrados</strong>
                <span>Crea un turno para iniciar.</span>
              </div>
            )}
          </div>
        </article>
        <aside className="panel talent-panel">
          <div className="panel-heading">
            <div>
              <h2>Equipo / contactos</h2>
              <p>Contactos de tu equipo registrados en esta cuenta.</p>
            </div>
          </div>
          <div className="worker-list">
            {workers.slice(0, 3).map((worker) => (
              <WorkerCompact key={worker.id} worker={worker} />
            ))}
            {!workers.length && (
              <div className="empty-state">
                <Users size={24} />
                <strong>Sin contactos registrados</strong>
                <span>Agrega trabajadores a tu equipo.</span>
              </div>
            )}
          </div>
          <button
            className="full-secondary"
            type="button"
            onClick={() => onNavigate("Trabajadores")}
          >
            <Users size={16} /> Gestionar trabajadores
          </button>
        </aside>
      </section>
      <section className="bottom-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Control de pagos</h2>
              <p>Resumen del periodo: {period.toLowerCase()}.</p>
            </div>
            <span className="safe-chip">
              <ShieldCheck size={13} /> Datos persistentes
            </span>
          </div>
          <div className="payments-layout">
            <div className="payment-total">
              <span>Total registrado</span>
              <strong>
                S/{" "}
                {payments
                  .reduce((sum, payment) => sum + payment.amount, 0)
                  .toLocaleString("es-PE", { minimumFractionDigits: 2 })}
              </strong>
              <small>{payments.length} movimientos</small>
              <div className="payment-progress">
                <i />
              </div>
              <p>
                <Check size={13} />{" "}
                {
                  payments.filter(
                    (payment) => payment.rawStatus === "PROCESSED",
                  ).length
                }{" "}
                pagos reportados
              </p>
            </div>
            <div className="payment-stats">
              <div>
                <span>
                  <WalletCards size={16} /> Reportado
                </span>
                <strong>
                  S/{" "}
                  {payments
                    .filter((payment) => payment.rawStatus === "PROCESSED")
                    .reduce((sum, payment) => sum + payment.amount, 0)
                    .toLocaleString("es-PE")}
                </strong>
              </div>
              <div>
                <span>
                  <TrendingUp size={16} /> Pendiente
                </span>
                <strong>S/ {pending.toLocaleString("es-PE")}</strong>
              </div>
              <button type="button" onClick={() => onNavigate("Pagos")}>
                Revisar detalle <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Pendientes operativos</h2>
              <p>Acciones derivadas de la información registrada.</p>
            </div>
            <button
              className="row-action"
              type="button"
              aria-label="Ver mensajes"
              onClick={() => onNavigate("Mensajes")}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className="activity-list">
            {operationalActions.map(({ icon: Icon, title, detail, tone, onClick }) => (
              <button className="activity-item activity-action" key={title} type="button" onClick={onClick}>
                <span className={`activity-icon ${tone}`}>
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            ))}
            {!operationalActions.length && (
              <div className="empty-state compact-empty-state">
                <CheckCircle2 size={22} />
                <strong>No hay pendientes registrados</strong>
                <span>La operación está al día con la información disponible.</span>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function ViewHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="view-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="view-header-actions">{children}</div>
    </section>
  );
}
function MetricCard({
  label,
  value,
  trend,
  icon: Icon,
  gold = false,
}: {
  label: string;
  value: string;
  trend: string;
  icon: typeof CalendarDays;
  gold?: boolean;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <div className={`metric-icon${gold ? " gold" : ""}`}>
          <Icon size={19} />
        </div>
        <span className="trend">{trend}</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </article>
  );
}
function MiniStat({
  label,
  value,
  detail,
  icon: Icon,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof CalendarDays;
  warning?: boolean;
}) {
  return (
    <article className="mini-stat">
      <div className={`mini-stat-icon${warning ? " warning" : ""}`}>
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function ShiftRow({ shift, onSelect }: { shift: Shift; onSelect: () => void }) {
  return (
    <button className="shift-row" role="row" type="button" onClick={onSelect}>
      <span className="shift-role">
        <span className="role-icon">
          <BriefcaseBusiness size={17} />
        </span>
        <span>
          <strong>{shift.role}</strong>
          <small>
            {shift.location} · {shift.schedule}
          </small>
        </span>
      </span>
      <span className="staffing">
        <span className="avatar-stack">
          {Array.from({ length: Math.min(shift.confirmed, 3) }).map(
            (_, index) => (
              <i key={index}>{["AM", "CR", "LV"][index]}</i>
            ),
          )}
        </span>
        <span>
          <strong>
            {shift.confirmed}/{shift.required}
          </strong>
          <small>confirmados</small>
        </span>
      </span>
      <span>
        <span className={`coverage-badge ${coverageClass(shift.coverage)}`}>
          {shift.coverage}
        </span>
        {isShiftExpired(shift) && (
          <span className="expired-badge">Vencido</span>
        )}
      </span>
      <span className="row-pay">
        <strong>S/ {shift.pay}</strong>
        <small>por persona</small>
      </span>
      <span className="row-action">
        <MoreHorizontal size={18} />
      </span>
    </button>
  );
}
function ManagedShift({
  shift,
  selected,
  onSelect,
}: {
  shift: Shift;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`managed-shift${selected ? " selected" : ""}`}
      type="button"
      onClick={onSelect}
    >
      <span className="managed-date">
        <strong>{shift.date.split(",")[0]}</strong>
        <small>
          {shift.date.includes(",") ? shift.date.split(",")[1] : "Nuevo"}
        </small>
      </span>
      <span className="managed-copy">
        <strong>{shift.role}</strong>
        <small>
          <Clock3 size={13} /> {shift.schedule}
          <i />
          <MapPin size={13} /> {shift.location}
        </small>
      </span>
      <span className="managed-coverage">
        <span className={`coverage-badge ${coverageClass(shift.coverage)}`}>
          {shift.coverage}
        </span>
        {isShiftExpired(shift) && (
          <span className="expired-badge">Vencido</span>
        )}
        <small>
          {shift.confirmed}/{shift.required} confirmados
        </small>
      </span>
      <span className="managed-pay">
        <strong>S/ {shift.pay}</strong>
        <small>por persona</small>
      </span>
    </button>
  );
}
function WorkerCompact({ worker }: { worker: Worker }) {
  return (
    <div className="worker-card">
      <span className="worker-avatar">
        {worker.initials}
        <i />
      </span>
      <span className="worker-info">
        <strong>{worker.name}</strong>
        <small>{worker.role}</small>
        <em>{worker.available}</em>
      </span>
      <span className="worker-match">
        <strong>{worker.status}</strong>
        <small>estado</small>
      </span>
    </div>
  );
}

function WorkerDirectoryCard({
  worker,
  onMessage,
  onEdit,
  onDelete,
}: {
  worker: Worker;
  onMessage: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="directory-card">
      <div className="directory-top">
        <span className="directory-avatar">
          {worker.initials}
          <i className={worker.status === "Disponible" ? "" : "away"} />
        </span>
        <span className="inline-actions">
          <button
            className="row-action"
            type="button"
            aria-label={`Editar ${worker.name}`}
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
          <button
            className="row-action danger"
            type="button"
            aria-label={`Eliminar ${worker.name}`}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        </span>
      </div>
      <div className="directory-identity">
        <h3>
          {worker.name}
        </h3>
        <p>{worker.role}</p>
        <span
          className={`availability ${worker.status === "Disponible" ? "" : "muted"}`}
        >
          {worker.available}
        </span>
      </div>
      <div className="skill-row">
        {worker.skills.map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>
      <div className="directory-actions">
        <button className="secondary-button" type="button" onClick={onMessage}>
          <MessageSquareText size={16} /> Mensaje
        </button>
        <button className="primary-button" type="button" onClick={onEdit}>
          <Pencil size={16} /> Editar
        </button>
      </div>
    </article>
  );
}

function TransactionRow({
  transaction,
  onEdit,
  onDelete,
  onMarkProcessed,
}: {
  transaction: Transaction;
  onEdit: () => void;
  onDelete: () => void;
  onMarkProcessed: () => void;
}) {
  return (
    <div className="transaction-row">
      <span className="transaction-name">
        <i className={transaction.status === "Procesado" ? "in" : ""}>
          {transaction.status === "Procesado" ? (
            <ArrowDownLeft size={16} />
          ) : (
            <Clock3 size={16} />
          )}
        </i>
        <span>
          <strong>{transaction.description}</strong>
          <small>
            {transaction.workerName ? `${transaction.workerName} · ` : ""}
            {transaction.reference} · {transaction.date}
          </small>
        </span>
      </span>
      <span>{transaction.workers}</span>
      <span>
        <b className={`payment-status ${transaction.status.toLowerCase()}`}>
          {transaction.status}
        </b>
        {transaction.status === "Pendiente" && (
          <button
            className="payment-quick-action"
            type="button"
            onClick={onMarkProcessed}
          >
            <Check size={12} /> Marcar pagado
          </button>
        )}
      </span>
      <span className="transaction-amount">
        S/ {transaction.amount.toLocaleString("es-PE")}
      </span>
      <span className="inline-actions">
        <button
          className="row-action"
          type="button"
          aria-label={`Editar ${transaction.reference}`}
          onClick={onEdit}
        >
          <Pencil size={15} />
        </button>
        <button
          className="row-action danger"
          type="button"
          aria-label={`Eliminar ${transaction.reference}`}
          onClick={onDelete}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

function PublishModal({
  shift,
  saving,
  onClose,
  onSubmit,
}: {
  shift: Shift | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const localDateTime = (value?: string) =>
    value
      ? new Date(
        new Date(value).getTime() -
        new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
      : "";
  // El servidor rechaza un turno cuyo `endsAt` ya pasó (creación y edición).
  // `min` no reemplaza esa validación -el navegador la puede ignorar o el
  // reloj local puede estar mal- pero evita el caso común de que el
  // formulario ofrezca sin aviso una fecha que el servidor va a rechazar.
  const minEndsAt = localDateTime(new Date().toISOString());
  const formRef = useRef<HTMLFormElement>(null);
  const fillExample = () => {
    if (
      shift &&
      !window.confirm(
        "Esto reemplazará los datos actuales del turno con un ejemplo. ¿Deseas continuar?",
      )
    )
      return;
    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(17, 0, 0, 0);
    const toInputDateTime = (date: Date) => {
      const offsetDate = new Date(
        date.getTime() - date.getTimezoneOffset() * 60000,
      );
      return offsetDate.toISOString().slice(0, 16);
    };
    const values: Record<string, string> = {
      role: "Anfitrión/a de eventos",
      description:
        "Buscamos una persona cordial y organizada para orientar a los asistentes, apoyar el registro y mantener una experiencia de bienvenida ágil durante el evento.",
      responsibilities:
        "Recibir y orientar a los asistentes.\nApoyar el registro de ingreso.\nCoordinar con el responsable de sala.",
      requirements:
        "Experiencia en atención al cliente.\nComunicación clara y puntualidad.\nDisponibilidad durante todo el horario.",
      screeningQuestions:
        "¿Tienes disponibilidad durante todo el horario indicado?\n¿Cuentas con experiencia atendiendo público?",
      startsAt: toInputDateTime(start),
      endsAt: toInputDateTime(end),
      location: "Miraflores, Lima",
      modality: "PRESENCIAL",
      required: "2",
      pay: "120",
      notes:
        "Presentarse 15 minutos antes en recepción. Vestimenta casual y prolija.",
    };
    Object.entries(values).forEach(([name, value]) => {
      const control = formRef.current?.elements.namedItem(name) as
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!control) return;
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-card publish-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Oferta de turno</p>
            <h2 id="publish-title">
              {shift ? "Editar publicación" : "Crear publicación"}
            </h2>
            <p>
              Completa información clara para recibir postulantes adecuados.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <form ref={formRef} onSubmit={onSubmit}>
          <div className="example-fill">
            <div>
              <strong>¿Quieres probar el formulario?</strong>
              <small>
                Completa campos con datos de ejemplo válidos. Puedes editarlos
                antes de publicar.
              </small>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={fillExample}
            >
              <Sparkles size={16} /> Rellenar ejemplo
            </button>
          </div>
          <div className="publish-step">
            <span>1</span>
            <div>
              <strong>Información del puesto</strong>
              <small>Lo primero que verá el trabajador.</small>
            </div>
          </div>
          <div className="form-grid">
            <label className="field full">
              <span>Cargo o rol</span>
              <input
                name="role"
                required
                minLength={2}
                maxLength={120}
                defaultValue={shift?.role}
                placeholder="Ej. Mozo/a de salón"
                list="common-roles"
              />
              <datalist id="common-roles">
                <option value="Mozo/a de salón" />
                <option value="Ayudante de cocina" />
                <option value="Personal de limpieza" />
                <option value="Promotor/a de ventas" />
                <option value="Operario/a de almacén" />
                <option value="Anfitrión/a de eventos" />
              </datalist>
            </label>
            <label className="field full">
              <span>Descripción del turno</span>
              <textarea
                name="description"
                required
                minLength={20}
                maxLength={4000}
                rows={3}
                defaultValue={shift?.description ?? ""}
                placeholder="Explica el objetivo del turno, el entorno de trabajo y qué apoyo necesita tu equipo."
              />
            </label>
            <label className="field full">
              <span>Funciones principales</span>
              <textarea
                name="responsibilities"
                required
                minLength={10}
                maxLength={3000}
                rows={3}
                defaultValue={shift?.responsibilities ?? ""}
                placeholder={
                  "Una función por línea.\nEj. Preparar el área antes del servicio."
                }
              />
            </label>
            <label className="field full">
              <span>Requisitos</span>
              <textarea
                name="requirements"
                required
                minLength={5}
                maxLength={3000}
                rows={3}
                defaultValue={shift?.requirements ?? ""}
                placeholder={
                  "Una condición por línea.\nEj. Experiencia en atención al cliente."
                }
              />
            </label>
            <label className="field full">
              <span>Preguntas de filtro (opcional)</span>
              <textarea
                name="screeningQuestions"
                maxLength={720}
                rows={3}
                defaultValue={shift?.screeningQuestions.join("\n") ?? ""}
                placeholder={
                  "Máximo 3 preguntas, una por línea.\nEj. ¿Tienes disponibilidad durante todo el horario indicado?"
                }
              />
              <small>
                El trabajador deberá responderlas antes de enviar su
                postulación. No solicites DNI, salud ni otros datos sensibles.
              </small>
            </label>
          </div>
          <div className="publish-step">
            <span>2</span>
            <div>
              <strong>Condiciones confirmadas</strong>
              <small>Horario, ubicación y pago sin sorpresas.</small>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Inicio</span>
              <input
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={localDateTime(shift?.startsAt)}
              />
            </label>
            <label className="field">
              <span>Fin</span>
              <input
                name="endsAt"
                type="datetime-local"
                required
                min={minEndsAt}
                defaultValue={localDateTime(shift?.endsAt)}
              />
            </label>
            <label className="field">
              <span>Sede o distrito</span>
              <input
                name="location"
                required
                minLength={2}
                defaultValue={shift?.location}
                placeholder="Miraflores, Lima"
              />
            </label>
            <label className="field">
              <span>Modalidad</span>
              <select
                name="modality"
                defaultValue={shift?.modality ?? "PRESENCIAL"}
              >
                <option value="PRESENCIAL">Presencial</option>
                <option value="HIBRIDO">Híbrido</option>
                <option value="REMOTO">Remoto</option>
              </select>
            </label>
            <label className="field">
              <span>Personas requeridas</span>
              <input
                name="required"
                required
                min="1"
                max="200"
                type="number"
                defaultValue={shift?.required ?? 1}
              />
            </label>
            <label className="field">
              <span>Pago por persona y turno</span>
              <div className="money-input">
                <span>S/</span>
                <input
                  name="pay"
                  required
                  min="1"
                  step="0.01"
                  type="number"
                  defaultValue={shift?.pay ?? 100}
                />
              </div>
            </label>
            <label className="field full">
              <span>Indicaciones después de seleccionar</span>
              <input
                name="notes"
                maxLength={2000}
                defaultValue={shift?.notes ?? ""}
                placeholder="Uniforme, punto de ingreso o responsable de recibir al personal"
              />
            </label>
          </div>
          <div className="publication-checklist">
            <ShieldCheck size={19} />
            <div>
              <strong>Antes de publicar</strong>
              <p>
                Verifica que el cargo sea real, el pago corresponda a una
                persona y que no solicites datos sensibles en la descripción.
              </p>
            </div>
          </div>
          <div className="modal-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="primary-button" disabled={saving} type="submit">
              <Plus size={17} />{" "}
              {saving
                ? "Guardando…"
                : shift
                  ? "Guardar y actualizar"
                  : "Revisar y publicar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
