"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import SmartTextInput from "../components/SmartTextInput";

type Building = { id: string; name: string };
type Equipment = { id: string; equipmentType: string; equipmentCode: string };
type PartItem = { name: string; quantity: string };
type PhotoItem = {
  name: string;
  url: string;
  dataUrl: string;
  mimeType: string;
  size: number;
};

type ChecklistGroup = {
  category: string;
  items: string[];
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

const stepTitles = [
  "Basic Information",
  "Service Checklist",
  "Photos & Notes",
  "Issues & Parts",
  "Review & Submit",
  "Signatures",
];

const stepDescriptions = [
  "Enter service visit details",
  "Complete inspection items",
  "Attach evidence and notes",
  "Report any problems or replacements",
  "Please review all information before submitting",
  "Sign and submit the report",
];

const checklistByType: Record<string, ChecklistGroup[]> = {
  Elevator: [
    {
      category: "Machine Room",
      items: [
        "General condition",
        "Traction machine/motor",
        "Control panel",
        "Electromagnetic brake",
      ],
    },
    {
      category: "Car",
      items: [
        "Push buttons",
        "Position indicator",
        "Door interlock",
        "Emergency light",
      ],
    },
    {
      category: "Hall",
      items: [
        "Hall buttons",
        "Door operation",
        "Guide shoes",
        "General condition",
      ],
    },
  ],
  Escalator: [
    {
      category: "Operation",
      items: [
        "Operating conditions",
        "Step and track condition",
        "Handrail condition",
        "Driving machine",
      ],
    },
    {
      category: "Safety",
      items: [
        "Emergency stop button",
        "Safety switches",
        "Fall prevention fence",
        "Skirt guard",
      ],
    },
  ],
  default: [
    {
      category: "General",
      items: [
        "Overall operation",
        "Safety devices",
        "Door and panel condition",
        "Abnormal noise/vibration",
      ],
    },
  ],
};

const FORM_STYLES = `
  @keyframes slideInFwd  { from{opacity:0;transform:translateX(22px)}  to{opacity:1;transform:translateX(0)} }
  @keyframes slideInBwd  { from{opacity:0;transform:translateX(-22px)} to{opacity:1;transform:translateX(0)} }
  @keyframes bounceIn    { 0%{transform:scale(0)} 60%{transform:scale(1.18)} 100%{transform:scale(1)} }
  @keyframes fadeUp      { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes checkPop    { 0%{transform:scale(0)} 70%{transform:scale(1.2)} 100%{transform:scale(1)} }
  @keyframes spinBtn     { to{transform:rotate(360deg)} }
  .form-input:focus      { border-color:#1b3c7b !important; box-shadow:0 0 0 3px rgba(27,60,123,.13); outline:none; }
  .form-input.error:focus{ border-color:#ef4444 !important; box-shadow:0 0 0 3px rgba(239,68,68,.13); }
  .checklist-btn         { transition:background .15s,border-color .15s,box-shadow .15s; }
  .checklist-btn.checked { background:linear-gradient(135deg,#f0fdf4,#dcfce7) !important; border-color:#16a34a !important; box-shadow:0 2px 8px rgba(22,163,74,.12); }
  .nav-btn               { transition:opacity .15s,transform .12s,box-shadow .15s; }
  .nav-btn:active        { transform:scale(.96) !important; }
  .nav-btn:hover         { filter:brightness(1.06); }
  .step-dot.completed    { background:#16a34a; border-color:#16a34a; box-shadow:0 2px 6px rgba(22,163,74,.3); }
  .step-dot.active       { background:#1b3c7b; border-color:#1b3c7b; box-shadow:0 2px 8px rgba(27,60,123,.35); transform:scale(1.15); }
  .success-icon          { animation:bounceIn .45s cubic-bezier(.22,.61,.36,1) both; }
  .success-code          { animation:fadeUp .35s .2s ease both; }
`;

const MAX_PHOTO_COUNT = 5;
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

const getLocalDateTimeParts = (date = new Date()) => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const localDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localTime = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  return {
    date: localDate,
    time: localTime,
    dateTime: `${localDate}T${localTime}`,
  };
};

const createInitialFormData = () => ({
  buildingId: "",
  equipmentType: "",
  equipmentId: "",
  maintenanceType: "Scheduled/Preventive Maintenance",
  arrivalDateTime: getLocalDateTimeParts().dateTime,
  technicianName: "Ko Aung Mya Oo",
  checklistState: {} as Record<string, string>,
  issuesFound: "",
  partsReplaced: "no",
  parts: [{ name: "", quantity: "1" }] as PartItem[],
  photos: [] as PhotoItem[],
  additionalNotes: "",
  customerMessage: "",
  completionDate: "",
  completionTime: "",
  customerName: "",
  customerTitle: "",
  techSignature: "",
  techSignatureLocked: false,
  customerSignature: "",
  customerSignatureLocked: false,
});

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error(`Could not read file: ${file.name}`));
    reader.readAsDataURL(file);
  });

const formatStatusLabel = (value: string) =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function Home() {
  const [step, setStep] = useState(1);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [dynamicChecklist, setDynamicChecklist] = useState<ChecklistGroup[] | null>(null);
  const [dynamicChecklistType, setDynamicChecklistType] = useState("");
  const [dynamicChecklistName, setDynamicChecklistName] = useState<string | null>(null);
  const [isChecklistLoading, setIsChecklistLoading] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successReportCode, setSuccessReportCode] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [stepDir, setStepDir] = useState<"forward" | "backward">("forward");
  const techCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const customerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingTechRef = useRef(false);
  const isDrawingCustomerRef = useRef(false);

  const [formData, setFormData] = useState(createInitialFormData);

  const arrivalDate = formData.arrivalDateTime.split("T")[0] ?? "";
  const arrivalTime = formData.arrivalDateTime.split("T")[1] ?? "";
  const completionDate = formData.completionDate;
  const completionTime = formData.completionTime;

  const selectedChecklist =
    dynamicChecklist && dynamicChecklistType === formData.equipmentType
      ? dynamicChecklist
      : checklistByType[formData.equipmentType] ?? checklistByType.default;

  useEffect(() => {
    if (!formData.equipmentType) {
      setDynamicChecklist(null);
      setDynamicChecklistType("");
      setDynamicChecklistName(null);
      setIsChecklistLoading(false);
      return;
    }

    setDynamicChecklist(null);
    setDynamicChecklistType("");
    setDynamicChecklistName(null);
    let isActive = true;

    const loadChecklistTemplate = async () => {
      setIsChecklistLoading(true);
      try {
        const query = new URLSearchParams({ equipmentType: formData.equipmentType });
        const response = await fetch(`${API_BASE_URL}/checklists/template?${query.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | { data?: { name?: string | null; categories?: ChecklistGroup[] | null } | null }
          | null;

        if (!isActive) {
          return;
        }

        const template = payload?.data;
        const categories = template?.categories;
        const hasCategories = Array.isArray(categories) && categories.length > 0;
        setDynamicChecklist(hasCategories ? categories : null);
        setDynamicChecklistType(hasCategories ? formData.equipmentType : "");
        setDynamicChecklistName(hasCategories ? (template?.name ?? null) : null);
      } catch {
        if (isActive) {
          setDynamicChecklist(null);
          setDynamicChecklistType("");
          setDynamicChecklistName(null);
        }
      } finally {
        if (isActive) {
          setIsChecklistLoading(false);
        }
      }
    };

    void loadChecklistTemplate();

    return () => {
      isActive = false;
    };
  }, [formData.equipmentType]);

  useEffect(() => {
    setFormData((prev) => {
      const nextChecklist: Record<string, string> = {};
      selectedChecklist.forEach((group, groupIndex) => {
        group.items.forEach((_, itemIndex) => {
          const key = `${groupIndex}-${itemIndex}`;
          nextChecklist[key] = prev.checklistState[key] ?? "";
        });
      });

      const prevKeys = Object.keys(prev.checklistState).sort().join(",");
      const nextKeys = Object.keys(nextChecklist).sort().join(",");
      if (prevKeys === nextKeys) return prev;

      return { ...prev, checklistState: nextChecklist };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.equipmentType, dynamicChecklist]);

  useEffect(() => {
    const initLookups = async () => {
      try {
        const [buildingsRes, typesRes] = await Promise.all([
          fetch(`${API_BASE_URL}/equipment/buildings`),
          fetch(`${API_BASE_URL}/equipment/types`),
        ]);
        const buildingsPayload = await buildingsRes.json();
        const typesPayload = await typesRes.json();
        setBuildings(buildingsPayload.data ?? []);
        setEquipmentTypes(
          (typesPayload.data ?? []).map((item: { equipmentType: string }) => item.equipmentType),
        );
      } catch {
        setSubmitMessage("Cannot load lookup data. Please ensure backend is running.");
      }
    };

    void initLookups();
  }, []);

  useEffect(() => {
    const fetchEquipment = async () => {
      if (!formData.buildingId) {
        setEquipmentList([]);
        return;
      }

      const query = new URLSearchParams({ buildingId: formData.buildingId });
      if (formData.equipmentType) {
        query.set("equipmentType", formData.equipmentType);
      }

      const res = await fetch(`${API_BASE_URL}/equipment/by-building?${query.toString()}`);
      const payload = await res.json();
      setEquipmentList(payload.data ?? []);
    };

    void fetchEquipment();
  }, [formData.buildingId, formData.equipmentType]);

  const checkedCount = useMemo(
    () => Object.values(formData.checklistState).filter((v) => v !== "").length,
    [formData.checklistState],
  );

  const totalCount = useMemo(
    () => Object.keys(formData.checklistState).length,
    [formData.checklistState],
  );

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getStepErrors = (currentStep: number): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (currentStep === 1) {
      if (!formData.buildingId) errors.buildingId = "Building is required";
      if (!formData.equipmentType) errors.equipmentType = "Equipment type is required";
      if (!formData.equipmentId) errors.equipmentId = "Equipment ID is required";
      if (!arrivalDate) errors.arrivalDate = "Arrival date is required";
      if (!arrivalTime) errors.arrivalTime = "Arrival time is required";
    }

    if (currentStep === 2) {
      if (checkedCount < 1) errors.checklist = "Please set status for at least one checklist item";
    }

    if (currentStep === 6) {
      if (!formData.completionDate) errors.completionDate = "Completion date is required";
      if (!formData.completionTime) errors.completionTime = "Completion time is required";
      if (!formData.customerName) errors.customerName = "Customer name is required";
      if (!formData.techSignature) errors.techSignature = "Technician signature is required";
      if (!formData.customerSignature) errors.customerSignature = "Customer signature is required";
    }

    return errors;
  };

  useEffect(() => {
    if (Object.keys(stepErrors).length === 0) {
      return;
    }
    setStepErrors(getStepErrors(step));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    checkedCount,
    formData.buildingId,
    formData.equipmentType,
    formData.equipmentId,
    formData.arrivalDateTime,
    formData.completionDate,
    formData.completionTime,
    formData.customerName,
    formData.techSignature,
    formData.customerSignature,
  ]);

  const updateArrival = (date: string, time: string) => {
    if (!date && !time) {
      updateField("arrivalDateTime", "");
      return;
    }
    const now = getLocalDateTimeParts();
    const normalizedDate = date || now.date;
    const normalizedTime = time || "00:00";
    updateField("arrivalDateTime", `${normalizedDate}T${normalizedTime}`);
  };

  const updateCompletion = (date: string, time: string) => {
    setFormData((prev) => ({
      ...prev,
      completionDate: date,
      completionTime: time,
    }));
  };

  const CHECKLIST_STATUSES = ["good", "adjusted", "repair", "na"] as const;
  const CHECKLIST_STATUS_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
    good:     { label: "Good",             color: "#166534", bg: "#dcfce7", border: "#16a34a" },
    adjusted: { label: "Adjusted",         color: "#854d0e", bg: "#fef9c3", border: "#ca8a04" },
    repair:   { label: "Repair / Replace", color: "#991b1b", bg: "#fee2e2", border: "#ef4444" },
    na:       { label: "N/A",              color: "#475569", bg: "#f1f5f9", border: "#94a3b8" },
  };

  const setChecklistStatus = (key: string, status: string) => {
    setFormData((prev) => ({
      ...prev,
      checklistState: {
        ...prev.checklistState,
        [key]: prev.checklistState[key] === status ? "" : status,
      },
    }));
  };

  const updatePart = (index: number, key: keyof PartItem, value: string) => {
    setFormData((prev) => {
      const next = [...prev.parts];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, parts: next };
    });
  };

  const addPart = () => {
    setFormData((prev) => ({
      ...prev,
      parts: [...prev.parts, { name: "", quantity: "1" }],
    }));
  };

  const removePart = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      parts: prev.parts.filter((_, i) => i !== index),
    }));
  };

  const onPhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const remainingSlots = Math.max(0, MAX_PHOTO_COUNT - formData.photos.length);
    if (remainingSlots === 0) {
      setSubmitMessage(`You can upload up to ${MAX_PHOTO_COUNT} photos only.`);
      event.target.value = "";
      return;
    }

    const selectedFiles = files.slice(0, remainingSlots);
    const oversizedFiles = selectedFiles.filter((file) => file.size > MAX_PHOTO_SIZE_BYTES);
    const acceptedFiles = selectedFiles.filter((file) => file.size <= MAX_PHOTO_SIZE_BYTES);

    if (oversizedFiles.length > 0) {
      setSubmitMessage(
        `Some files were skipped because they are larger than ${Math.round(
          MAX_PHOTO_SIZE_BYTES / (1024 * 1024),
        )}MB.`,
      );
    }

    if (acceptedFiles.length > 0) {
      const nextPhotos = await Promise.all(
        acceptedFiles.map(async (file) => ({
          name: file.name,
          url: URL.createObjectURL(file),
          dataUrl: await fileToDataUrl(file),
          mimeType: file.type || "image/png",
          size: file.size,
        })),
      );

      setFormData((prev) => ({
        ...prev,
        photos: [...prev.photos, ...nextPhotos],
      }));
    }

    if (files.length > remainingSlots) {
      setSubmitMessage(`Only the first ${MAX_PHOTO_COUNT} photos were kept.`);
    }

    event.target.value = "";
  };

  const removePhoto = (targetIndex: number) => {
    setFormData((prev) => {
      const targetPhoto = prev.photos[targetIndex];
      if (targetPhoto) {
        URL.revokeObjectURL(targetPhoto.url);
      }

      return {
        ...prev,
        photos: prev.photos.filter((_, index) => index !== targetIndex),
      };
    });
  };

  const getTechCanvasContext = () => {
    const canvas = techCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    return { canvas, context };
  };

  const initializeSignatureCanvas = (
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    signatureDataUrl?: string,
  ) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (!signatureDataUrl) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = signatureDataUrl;
  };

  const initTechCanvas = (signatureDataUrl = formData.techSignature) => {
    const drawing = getTechCanvasContext();
    if (!drawing) {
      return;
    }
    initializeSignatureCanvas(drawing.canvas, drawing.context, signatureDataUrl);
  };

  const getCustomerCanvasContext = () => {
    const canvas = customerCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    return { canvas, context };
  };

  const initCustomerCanvas = (signatureDataUrl = formData.customerSignature) => {
    const drawing = getCustomerCanvasContext();
    if (!drawing) {
      return;
    }
    initializeSignatureCanvas(drawing.canvas, drawing.context, signatureDataUrl);
  };

  useEffect(() => {
    if (step !== 5) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      initTechCanvas();
      initCustomerCanvas();
    });

    return () => window.cancelAnimationFrame(frameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, formData.techSignature, formData.customerSignature]);

  const getCanvasPoint = (
    event: PointerEvent<HTMLCanvasElement>,
    canvas: HTMLCanvasElement,
  ) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const startTechDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (formData.techSignatureLocked) {
      return;
    }
    const drawing = getTechCanvasContext();
    if (!drawing) {
      return;
    }
    const point = getCanvasPoint(event, drawing.canvas);
    drawing.context.beginPath();
    drawing.context.moveTo(point.x, point.y);
    isDrawingTechRef.current = true;
  };

  const moveTechDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (formData.techSignatureLocked) {
      return;
    }
    if (!isDrawingTechRef.current) {
      return;
    }
    const drawing = getTechCanvasContext();
    if (!drawing) {
      return;
    }
    const point = getCanvasPoint(event, drawing.canvas);
    drawing.context.lineTo(point.x, point.y);
    drawing.context.stroke();
  };

  const endTechDrawing = () => {
    if (formData.techSignatureLocked) {
      return;
    }
    if (!isDrawingTechRef.current) {
      return;
    }
    isDrawingTechRef.current = false;
    const drawing = getTechCanvasContext();
    if (!drawing) {
      return;
    }
    updateField("techSignature", drawing.canvas.toDataURL("image/png"));
  };

  const clearTechSignature = () => {
    setFormData((prev) => ({
      ...prev,
      techSignature: "",
      techSignatureLocked: false,
    }));
    initTechCanvas("");
  };

  const markTechSignature = () => {
    if (!formData.techSignature) {
      setStepErrors((prev) => ({
        ...prev,
        techSignature: "Technician signature is required",
      }));
      setSubmitMessage("Please draw technician signature before marking as signed.");
      return;
    }

    setFormData((prev) => ({
      ...prev,
      techSignatureLocked: true,
    }));
  };

  const startCustomerDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (formData.customerSignatureLocked) {
      return;
    }
    const drawing = getCustomerCanvasContext();
    if (!drawing) {
      return;
    }
    const point = getCanvasPoint(event, drawing.canvas);
    drawing.context.beginPath();
    drawing.context.moveTo(point.x, point.y);
    isDrawingCustomerRef.current = true;
  };

  const moveCustomerDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (formData.customerSignatureLocked) {
      return;
    }
    if (!isDrawingCustomerRef.current) {
      return;
    }
    const drawing = getCustomerCanvasContext();
    if (!drawing) {
      return;
    }
    const point = getCanvasPoint(event, drawing.canvas);
    drawing.context.lineTo(point.x, point.y);
    drawing.context.stroke();
  };

  const endCustomerDrawing = () => {
    if (formData.customerSignatureLocked) {
      return;
    }
    if (!isDrawingCustomerRef.current) {
      return;
    }
    isDrawingCustomerRef.current = false;
    const drawing = getCustomerCanvasContext();
    if (!drawing) {
      return;
    }
    updateField("customerSignature", drawing.canvas.toDataURL("image/png"));
  };

  const clearCustomerSignature = () => {
    setFormData((prev) => ({
      ...prev,
      customerSignature: "",
      customerSignatureLocked: false,
    }));
    initCustomerCanvas("");
  };

  const markCustomerSignature = () => {
    if (!formData.customerSignature) {
      setStepErrors((prev) => ({
        ...prev,
        customerSignature: "Customer signature is required",
      }));
      setSubmitMessage("Please draw customer signature before marking as signed.");
      return;
    }

    setFormData((prev) => ({
      ...prev,
      customerSignatureLocked: true,
    }));
  };

  const resetForm = () => {
    formData.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setShowSuccessModal(false);
    setSuccessReportCode(null);
    setSuccessStatus(null);
    setStep(1);
    setSubmitMessage("");
    setStepErrors({});
    setFormData(createInitialFormData());
  };

  const goNext = () => {
    const errors = getStepErrors(step);
    if (Object.keys(errors).length > 0) {
      setStepErrors(errors);
      setSubmitMessage("Please complete required information in this step.");
      return;
    }
    setStepErrors({});
    setSubmitMessage("");
    setStepDir("forward");
    setStep((prev) => Math.min(6, prev + 1));
  };

  const goPrev = () => {
    setStepDir("backward");
    setStep((prev) => Math.max(1, prev - 1));
  };

  const submitReport = async () => {
    setLoading(true);
    setSubmitMessage("");

    try {
      const remarksParts = [
        formData.issuesFound ? `Issues: ${formData.issuesFound}` : "",
        formData.additionalNotes ? `Notes: ${formData.additionalNotes}` : "",
        formData.customerMessage ? `Customer message: ${formData.customerMessage}` : "",
      ].filter(Boolean);

      const checklistResults = {
        equipmentType: formData.equipmentType,
        templateName:
          dynamicChecklist && dynamicChecklistType === formData.equipmentType
            ? dynamicChecklistName
            : null,
        checkedCount,
        totalCount,
        categories: selectedChecklist.map((group, groupIndex) => ({
          category: group.category,
          items: group.items.map((item, itemIndex) => ({
            label: item,
            status: formData.checklistState[`${groupIndex}-${itemIndex}`] || "",
            checked: formData.checklistState[`${groupIndex}-${itemIndex}`] !== "",
          })),
        })),
      };

      const payload = {
        buildingId: formData.buildingId,
        equipmentId: formData.equipmentId,
        maintenanceType: formData.maintenanceType,
        arrivalDateTime: new Date(formData.arrivalDateTime).toISOString(),
        technicianName: formData.technicianName,
        checklistResults,
        findings: `${checkedCount}/${totalCount} checklist items assessed`,
        workPerformed: formData.partsReplaced === "yes" ? "Parts replaced" : "Routine service",
        partsUsed:
          formData.partsReplaced === "yes"
            ? formData.parts
                .filter((part) => part.name.trim())
                .map((part) => ({
                  name: part.name,
                  quantity: Number(part.quantity || "1"),
                }))
            : [],
        remarks: remarksParts.join(" | "),
        photos: formData.photos.map((photo) => ({
          name: photo.name,
          mimeType: photo.mimeType,
          size: photo.size,
          dataUrl: photo.dataUrl,
        })),
        technicianSignature: formData.techSignature,
        customerSignature: formData.customerSignature,
      };

      const res = await fetch(`${API_BASE_URL}/maintenance-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message ?? "Submit failed");
      }

      setSuccessReportCode(result.data.reportCode ?? null);
      setSuccessStatus(result.data.status ?? null);
      setShowSuccessModal(true);
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : "Could not submit report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
      <style>{FORM_STYLES}</style>
      <div className="mx-auto flex min-h-screen w-full max-w-md sm:max-w-lg md:max-w-2xl flex-col bg-white shadow-lg sm:my-0 md:my-4 md:min-h-0 md:rounded-2xl md:shadow-2xl">
        <header className="bg-[#1b3c7b] px-4 py-3.5 sm:px-6 text-white shadow-md md:rounded-t-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shrink-0">
                <span className="text-[10px] leading-tight font-bold text-[#1b3c7b] text-center">
                  YOMA
                  <br />
                  ELEV
                </span>
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold leading-tight">Maintenance Service Report</h1>
                <p className="text-xs text-white/70">YECL Field Technician Form</p>
              </div>
            </div>

            <a
              href="/admin"
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-[11px] font-semibold text-white transition-all hover:bg-white/20 active:scale-95 flex items-center gap-1.5 shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="1" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="7" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="7" y="7" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
              Admin
            </a>
          </div>
        </header>

        <div className="bg-white px-4 sm:px-6 pb-3 pt-4 shadow-sm">
          <div className="relative mb-3 flex items-center justify-between">
            <div className="absolute inset-x-0 top-1/2 z-[1] h-[3px] -translate-y-1/2 rounded-full bg-slate-200" />
            <div
              className="absolute left-0 top-1/2 z-[1] h-[3px] -translate-y-1/2 rounded-full bg-[#16a34a] transition-all duration-500"
              style={{ width: `${((step - 1) / 5) * 100}%` }}
            />
            {stepTitles.map((title, index) => {
              const current = index + 1;
              const active = current === step;
              const completed = current < step;
              return (
                <div key={current} className="relative z-[2] flex flex-col items-center gap-1.5">
                  <div
                    className="step-dot flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border-2 border-slate-300 bg-white text-xs font-bold transition-all duration-300"
                    style={
                      active ? { background: "#1b3c7b", borderColor: "#1b3c7b", color: "#fff", transform: "scale(1.1)", boxShadow: "0 2px 8px rgba(27,60,123,.35)" }
                      : completed ? { background: "#16a34a", borderColor: "#16a34a", color: "#fff", boxShadow: "0 2px 6px rgba(22,163,74,.3)" }
                      : { color: "#94a3b8" }
                    }
                  >
                    {completed
                      ? <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      : current
                    }
                  </div>
                  <span className={`hidden sm:block text-[10px] font-medium max-w-[70px] text-center leading-tight ${active ? "text-[#1b3c7b]" : completed ? "text-green-600" : "text-slate-400"}`}>{title}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-1.5 sm:hidden">
            <p className="text-center text-xs font-semibold text-slate-500">{stepTitles[step - 1]}</p>
            <span className="text-xs text-slate-400">·</span>
            <p className="text-xs text-slate-400">{step} of 6</p>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          <div
            key={step}
            style={{ animation: `${stepDir === "forward" ? "slideInFwd" : "slideInBwd"} .22s ease both` }}
          >
          <h2 className="mb-1 text-xl sm:text-2xl font-bold text-[#1b3c7b]">{stepTitles[step - 1]}</h2>
          <p className="mb-5 text-sm sm:text-[15px] text-slate-500">{stepDescriptions[step - 1]}</p>

          {step === 1 && (
            <div className="space-y-5">
              {/* Location section */}
              <fieldset className="rounded-xl border-2 border-slate-200 bg-white p-4 space-y-4">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-slate-400">Location</legend>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-slate-400"><path d="M2 2h10v10H2z" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v2M9 1v2M2 5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    Building <span className="text-red-500">*</span>
                  </label>
                  <select
                    className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                      stepErrors.buildingId ? "error border-red-500 bg-red-50" : "border-slate-300 focus:border-[#1b3c7b] focus:ring-2 focus:ring-blue-100"
                    }`}
                    value={formData.buildingId}
                    onChange={(event) => updateField("buildingId", event.target.value)}
                  >
                    <option value="">Select building...</option>
                    {buildings.map((building) => (
                      <option key={building.id} value={building.id}>{building.name}</option>
                    ))}
                  </select>
                  {stepErrors.buildingId && <p className="mt-1 text-xs font-medium text-red-600">{stepErrors.buildingId}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-slate-400"><rect x="3" y="2" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M5.5 5h3M5.5 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Equipment Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                        stepErrors.equipmentType ? "error border-red-500 bg-red-50" : "border-slate-300 focus:border-[#1b3c7b] focus:ring-2 focus:ring-blue-100"
                      }`}
                      value={formData.equipmentType}
                      onChange={(event) => { updateField("equipmentType", event.target.value); updateField("equipmentId", ""); }}
                    >
                      <option value="">Select type...</option>
                      {equipmentTypes.map((et) => <option key={et} value={et}>{et}</option>)}
                    </select>
                    {stepErrors.equipmentType && <p className="mt-1 text-xs font-medium text-red-600">{stepErrors.equipmentType}</p>}
                  </div>
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-slate-400"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 4.5v5M4.5 7h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Equipment ID <span className="text-red-500">*</span>
                    </label>
                    <select
                      className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all disabled:cursor-not-allowed disabled:bg-slate-100 ${
                        stepErrors.equipmentId ? "error border-red-500 bg-red-50" : "border-slate-300 focus:border-[#1b3c7b] focus:ring-2 focus:ring-blue-100"
                      }`}
                      value={formData.equipmentId}
                      disabled={!formData.equipmentType}
                      onChange={(event) => updateField("equipmentId", event.target.value)}
                    >
                      <option value="">{formData.equipmentType ? "Select..." : "Select type first"}</option>
                      {equipmentList.map((eq) => <option key={eq.id} value={eq.id}>{eq.equipmentCode}</option>)}
                    </select>
                    {stepErrors.equipmentId && <p className="mt-1 text-xs font-medium text-red-600">{stepErrors.equipmentId}</p>}
                  </div>
                </div>
              </fieldset>

              {/* Visit details section */}
              <fieldset className="rounded-xl border-2 border-slate-200 bg-white p-4 space-y-4">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-slate-400">Visit Details</legend>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-slate-400"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 4v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Arrival Date & Time <span className="text-red-500">*</span>
                    </label>
                    <button
                      className="rounded-full bg-[#1b3c7b] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#15306a] active:scale-95 transition-all flex items-center gap-1"
                      type="button"
                      onClick={() => { const now = getLocalDateTimeParts(); updateArrival(now.date, now.time); }}
                    >
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M7 4v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      Now
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                        stepErrors.arrivalDate ? "error border-red-500 bg-red-50" : "border-slate-300 focus:border-[#1b3c7b] focus:ring-2 focus:ring-blue-100"
                      }`}
                      type="date"
                      value={arrivalDate}
                      onChange={(event) => updateArrival(event.target.value, arrivalTime)}
                    />
                    <input
                      className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                        stepErrors.arrivalTime ? "error border-red-500 bg-red-50" : "border-slate-300 focus:border-[#1b3c7b] focus:ring-2 focus:ring-blue-100"
                      }`}
                      type="time"
                      value={arrivalTime}
                      onChange={(event) => updateArrival(arrivalDate, event.target.value)}
                    />
                  </div>
                  {(stepErrors.arrivalDate || stepErrors.arrivalTime) && (
                    <p className="mt-1 text-xs font-medium text-red-600">{stepErrors.arrivalDate || stepErrors.arrivalTime}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-slate-400"><circle cx="7" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/><path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.2"/></svg>
                    Technician
                  </label>
                  <input
                    className="h-12 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 text-base text-slate-500 cursor-not-allowed"
                    value={formData.technicianName}
                    readOnly
                  />
                </div>
              </fieldset>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              {!formData.equipmentType && (
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
                  Please select equipment type in Basic Information.
                </div>
              )}

              {formData.equipmentType && isChecklistLoading && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                  Loading the latest checklist template for {formData.equipmentType}...
                </div>
              )}

              {formData.equipmentType && dynamicChecklist && !isChecklistLoading && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-700">
                  Using the checklist template configured in the admin portal for this equipment type.
                </div>
              )}

              {selectedChecklist.map((group, groupIndex) => (
                <div key={group.category} className="mb-6">
                  <div className="mb-3 rounded-lg bg-[hsl(222,60%,96%)] p-3 text-[17px] font-bold text-[#1b3c7b]">
                    {group.category}
                  </div>
                  {group.items.map((item, itemIndex) => {
                    const key = `${groupIndex}-${itemIndex}`;
                    const currentStatus = formData.checklistState[key] || "";
                    return (
                      <div key={item} className="mb-3 rounded-xl border-2 border-slate-200 bg-white p-3">
                        <div className="mb-2 text-[15px] font-medium text-slate-800">{item}</div>
                        <div className="flex flex-wrap gap-2">
                          {CHECKLIST_STATUSES.map((status) => {
                            const cfg = CHECKLIST_STATUS_LABELS[status];
                            const isSelected = currentStatus === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                onClick={() => setChecklistStatus(key, status)}
                                className="rounded-lg border-2 px-3 py-1.5 text-xs font-semibold transition-all"
                                style={isSelected
                                  ? { borderColor: cfg.border, background: cfg.bg, color: cfg.color }
                                  : { borderColor: "#e2e8f0", background: "#fff", color: "#64748b" }
                                }
                              >
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="sticky bottom-0 rounded-xl border-2 border-slate-200 bg-white p-3 shadow-sm">
                {stepErrors.checklist && (
                  <p className="mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">
                    {stepErrors.checklist}
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${totalCount > 0 ? (checkedCount / totalCount) * 100 : 0}%` }} />
                  </div>
                  <span className="text-sm font-bold text-slate-700 whitespace-nowrap">{checkedCount}/{totalCount}</span>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
                <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-slate-400"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/><circle cx="5.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M1.5 11l3.5-3 3 2.5 2.5-2 4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Photos
                  <span className="ml-auto text-xs font-normal text-slate-400">{formData.photos.length}/{MAX_PHOTO_COUNT}</span>
                </label>
                <label
                  htmlFor="photo-upload"
                  className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100 transition-all"
                >
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-slate-400 mb-2"><path d="M14 18V8M10 12l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 20v2a2 2 0 002 2h16a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  <span className="text-sm font-medium text-slate-600">Tap to upload photos</span>
                  <span className="mt-1 text-xs text-slate-400">PNG, JPG, WEBP - max 5MB each</span>
                </label>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onPhotoUpload}
                  className="hidden"
                />
                <p className="mt-2 text-sm text-slate-600">Uploaded: {formData.photos.length}</p>
                {formData.photos.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {formData.photos.map((photo, idx) => (
                      <figure key={`${photo.name}-${idx}`} className="relative overflow-hidden rounded-md border border-slate-300 bg-slate-50">
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="h-20 w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(idx)}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs font-bold text-white"
                          aria-label={`Remove ${photo.name}`}
                        >
                          x
                        </button>
                        <figcaption className="truncate px-1 py-1 text-[10px] text-slate-600" title={photo.name}>
                          {photo.name}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-[15px] font-semibold text-slate-900">
                  Additional Notes
                </label>
                <SmartTextInput
                  className="form-input min-h-[120px] w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base shadow-sm transition-all"
                  placeholder="Any additional comments or observations..."
                  value={formData.additionalNotes}
                  onChange={(v) => updateField("additionalNotes", v)}
                  field="notes"
                  equipmentType={formData.equipmentType}
                  minHeight="120px"
                />
              </div>

              <div>
                <label className="mb-2 block text-[15px] font-semibold text-slate-900">
                  Customer Message
                </label>
                <SmartTextInput
                  className="form-input min-h-[90px] w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base shadow-sm transition-all"
                  placeholder="Message to include in customer report..."
                  value={formData.customerMessage}
                  onChange={(v) => updateField("customerMessage", v)}
                  field="remarks"
                  equipmentType={formData.equipmentType}
                  minHeight="90px"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-[15px] font-semibold text-slate-900">
                  Any issues or abnormalities?
                </label>
                <SmartTextInput
                  className="form-input min-h-[120px] w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base shadow-sm transition-all"
                  placeholder="Describe any issues found during inspection..."
                  value={formData.issuesFound}
                  onChange={(v) => updateField("issuesFound", v)}
                  field="findings"
                  equipmentType={formData.equipmentType}
                  minHeight="120px"
                />
              </div>

              <div>
                <label className="mb-3 block text-[15px] font-semibold text-slate-900">
                  Did you replace any parts?
                </label>
                <div className="space-y-3">
                  {["no", "yes"].map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => updateField("partsReplaced", choice)}
                      className={`flex w-full items-center rounded-lg border-2 p-4 text-left capitalize ${
                        formData.partsReplaced === choice
                          ? "border-[#f59e0b] bg-[hsl(35,80%,95%)]"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      <span className="text-[15px] font-medium">{choice}</span>
                    </button>
                  ))}
                </div>
              </div>

              {formData.partsReplaced === "yes" && (
                <div className="space-y-3 rounded-lg border-2 border-slate-300 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-700">Parts</p>
                  {formData.parts.map((part, index) => (
                    <div key={`part-${index}`} className="grid grid-cols-5 gap-2">
                      <input
                        className="form-input col-span-3 h-11 rounded-xl border-2 border-slate-300 px-3 text-sm shadow-sm transition-all"
                        placeholder="Part name"
                        value={part.name}
                        onChange={(event) => updatePart(index, "name", event.target.value)}
                      />
                      <input
                        className="form-input col-span-1 h-11 rounded-xl border-2 border-slate-300 px-3 text-sm shadow-sm transition-all"
                        type="number"
                        min="1"
                        value={part.quantity}
                        onChange={(event) => updatePart(index, "quantity", event.target.value)}
                      />
                      <button
                        type="button"
                        className="col-span-1 h-11 rounded-lg bg-slate-200 text-sm font-semibold"
                        onClick={() => removePart(index)}
                        disabled={formData.parts.length === 1}
                      >
                        Del
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="h-10 rounded-lg bg-[#1b3c7b] px-4 text-sm font-semibold text-white"
                    onClick={addPart}
                  >
                    Add Part
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <section className="rounded-xl border-2 border-slate-200 bg-white p-4">
                <h3 className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-bold text-[#1b3c7b]">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10v10H2z" stroke="currentColor" strokeWidth="1.2"/><path d="M5 1v2M9 1v2M2 5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  Basic Information
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span className="text-slate-400 text-xs block">Building</span><span className="font-medium text-slate-800">{buildings.find((item) => item.id === formData.buildingId)?.name || "-"}</span></div>
                  <div><span className="text-slate-400 text-xs block">Equipment</span><span className="font-medium text-slate-800">{equipmentList.find((item) => item.id === formData.equipmentId)?.equipmentCode || "-"}</span></div>
                  <div><span className="text-slate-400 text-xs block">Service Date</span><span className="font-medium text-slate-800">{arrivalDate || "-"}</span></div>
                  <div><span className="text-slate-400 text-xs block">Arrival Time</span><span className="font-medium text-slate-800">{arrivalTime || "-"}</span></div>
                </dl>
              </section>

              <section className="rounded-xl border-2 border-slate-200 bg-white p-4">
                <h3 className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-bold text-[#1b3c7b]">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Service Summary
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><span className="text-slate-400 text-xs block">Checklist</span><span className="font-medium text-slate-800">{checkedCount}/{totalCount} assessed</span></div>
                  <div><span className="text-slate-400 text-xs block">Parts Replaced</span><span className="font-medium text-slate-800 capitalize">{formData.partsReplaced}</span></div>
                  <div><span className="text-slate-400 text-xs block">Photos</span><span className="font-medium text-slate-800">{formData.photos.length} uploaded</span></div>
                  <div><span className="text-slate-400 text-xs block">Issues</span><span className="font-medium text-slate-800 line-clamp-1">{formData.issuesFound || "None reported"}</span></div>
                </div>
                <div>Customer: {formData.customerName || "-"}</div>
                <div>Initial Ticket Status: pending</div>
              </section>

              {formData.photos.length > 0 && (
                <section className="rounded-xl border-2 border-slate-300 bg-white p-4 text-sm">
                  <h3 className="mb-3 border-b-2 border-slate-200 pb-2 text-sm font-bold text-[#1b3c7b]">
                    Photo Evidence
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {formData.photos.map((photo, idx) => (
                      <figure key={`${photo.name}-${idx}`} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                        <img src={photo.url} alt={photo.name} className="h-24 w-full object-cover" />
                        <figcaption className="truncate px-2 py-1 text-[11px] text-slate-600" title={photo.name}>
                          {photo.name}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              )}

            </div>
          )}

          {step === 6 && (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[15px] font-semibold text-slate-900">
                    Completion Date &amp; Time <span className="text-red-500">*</span>
                  </label>
                  <button
                    className="rounded-full bg-[#1b3c7b] px-4 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-[#15306a] active:scale-95 transition-all flex items-center gap-1.5"
                    type="button"
                    onClick={() => {
                      const now = getLocalDateTimeParts();
                      updateCompletion(now.date, now.time);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M7 4v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Now
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                      stepErrors.completionDate ? "error border-red-500 bg-red-50" : "border-slate-300"
                    }`}
                    type="date"
                    value={completionDate}
                    onChange={(event) => updateCompletion(event.target.value, completionTime)}
                  />
                  <input
                    className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                      stepErrors.completionTime ? "error border-red-500 bg-red-50" : "border-slate-300"
                    }`}
                    type="time"
                    value={completionTime}
                    onChange={(event) => updateCompletion(completionDate, event.target.value)}
                  />
                </div>
                {(stepErrors.completionDate || stepErrors.completionTime) && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    {stepErrors.completionDate || stepErrors.completionTime}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-[15px] font-semibold text-slate-900">
                  Building Representative <span className="text-red-500">*</span>
                </label>
                <input
                  className={`form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all ${
                    stepErrors.customerName ? "error border-red-500 bg-red-50" : "border-slate-300"
                  }`}
                  value={formData.customerName}
                  onChange={(event) => updateField("customerName", event.target.value)}
                  placeholder="Full Name"
                />
                {stepErrors.customerName && (
                  <p className="mt-1 text-xs font-medium text-red-600">{stepErrors.customerName}</p>
                )}
              </div>

              <div>
                <input
                  className="form-input h-12 w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-base shadow-sm transition-all"
                  value={formData.customerTitle}
                  onChange={(event) => updateField("customerTitle", event.target.value)}
                  placeholder="Title / Position (optional)"
                />
              </div>

              <div
                className={`rounded-lg border-2 bg-slate-50 p-3 ${
                  stepErrors.techSignature ? "border-red-500" : "border-slate-300"
                }`}
              >
                <p className="mb-2 text-[15px] font-semibold text-slate-900">Technician Signature *</p>
                {stepErrors.techSignature && (
                  <p className="mb-2 text-xs font-medium text-red-600">{stepErrors.techSignature}</p>
                )}
                <div
                  className={`relative rounded-lg border-2 border-dashed p-2 transition-all ${
                    stepErrors.techSignature ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"
                  } ${formData.techSignatureLocked ? "ring-2 ring-emerald-200 shadow-inner" : ""}`}
                >
                  <canvas
                    ref={techCanvasRef}
                    width={560}
                    height={180}
                    className={`h-36 w-full touch-none rounded-md ${
                      stepErrors.techSignature ? "bg-red-50" : "bg-white"
                    } ${formData.techSignatureLocked ? "pointer-events-none cursor-not-allowed opacity-70" : ""}`}
                    onPointerDown={startTechDrawing}
                    onPointerMove={moveTechDrawing}
                    onPointerUp={endTechDrawing}
                    onPointerLeave={endTechDrawing}
                  />
                  {formData.techSignatureLocked && (
                    <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-md bg-slate-900/10 backdrop-blur-[1px]">
                      <div className="rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-center shadow-sm">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                          Signed & Locked
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">Clear / Sign Again to unlock</p>
                      </div>
                    </div>
                  )}
                  {!formData.techSignature && !formData.techSignatureLocked && (
                    <p className="mt-2 text-center text-xs text-slate-500">
                      Sign here: press and drag to draw your signature
                    </p>
                  )}
                  {formData.techSignatureLocked && (
                    <p className="mt-2 text-center text-xs font-semibold text-emerald-700">
                      Signature locked successfully.
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="h-10 rounded-lg bg-[#1b3c7b] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    onClick={markTechSignature}
                    disabled={formData.techSignatureLocked || !formData.techSignature}
                  >
                    {formData.techSignatureLocked ? "Signed" : "Mark as Signed"}
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-lg bg-slate-200 px-4 text-sm font-bold text-slate-800"
                    onClick={clearTechSignature}
                  >
                    Clear / Sign Again
                  </button>
                </div>
              </div>

              <div
                className={`rounded-lg border-2 bg-slate-50 p-3 ${
                  stepErrors.customerSignature ? "border-red-500" : "border-slate-300"
                }`}
              >
                <p className="mb-2 text-[15px] font-semibold text-slate-900">Customer Signature *</p>
                {stepErrors.customerSignature && (
                  <p className="mb-2 text-xs font-medium text-red-600">{stepErrors.customerSignature}</p>
                )}
                <div
                  className={`relative rounded-lg border-2 border-dashed p-2 transition-all ${
                    stepErrors.customerSignature ? "border-red-400 bg-red-50" : "border-slate-300 bg-white"
                  } ${formData.customerSignatureLocked ? "ring-2 ring-emerald-200 shadow-inner" : ""}`}
                >
                  <canvas
                    ref={customerCanvasRef}
                    width={560}
                    height={180}
                    className={`h-36 w-full touch-none rounded-md ${
                      stepErrors.customerSignature ? "bg-red-50" : "bg-white"
                    } ${formData.customerSignatureLocked ? "pointer-events-none cursor-not-allowed opacity-70" : ""}`}
                    onPointerDown={startCustomerDrawing}
                    onPointerMove={moveCustomerDrawing}
                    onPointerUp={endCustomerDrawing}
                    onPointerLeave={endCustomerDrawing}
                  />
                  {formData.customerSignatureLocked && (
                    <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-md bg-slate-900/10 backdrop-blur-[1px]">
                      <div className="rounded-full border border-emerald-200 bg-white/95 px-4 py-2 text-center shadow-sm">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                          Signed & Locked
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">Clear / Sign Again to unlock</p>
                      </div>
                    </div>
                  )}
                  {!formData.customerSignature && !formData.customerSignatureLocked && (
                    <p className="mt-2 text-center text-xs text-slate-500">
                      Sign here: press and drag to draw your signature
                    </p>
                  )}
                  {formData.customerSignatureLocked && (
                    <p className="mt-2 text-center text-xs font-semibold text-emerald-700">
                      Signature locked successfully.
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="h-10 rounded-lg bg-[#1b3c7b] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    onClick={markCustomerSignature}
                    disabled={formData.customerSignatureLocked || !formData.customerSignature}
                  >
                    {formData.customerSignatureLocked ? "Signed" : "Mark as Signed"}
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-lg bg-slate-200 px-4 text-sm font-bold text-slate-800"
                    onClick={clearCustomerSignature}
                  >
                    Clear / Sign Again
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        </main>

        <footer className="flex gap-3 bg-white px-4 sm:px-6 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] md:rounded-b-2xl">
          {step > 1 && (
            <button
              className="nav-btn h-12 sm:h-11 flex-1 rounded-xl bg-slate-100 px-4 text-sm font-bold text-slate-600 disabled:opacity-50 flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-200 active:scale-[.98] transition-all"
              onClick={goPrev}
              disabled={loading}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Previous
            </button>
          )}

          {step < 6 ? (
            <button
              className="nav-btn h-12 sm:h-11 flex-[1.2] rounded-xl bg-[#1b3c7b] px-4 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2 shadow-md hover:shadow-lg hover:bg-[#15306a] active:scale-[.98] transition-all"
              onClick={goNext}
              disabled={loading}
            >
              Next Step
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          ) : (
            <button
              className="nav-btn h-12 sm:h-11 flex-[1.2] flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50 shadow-md hover:shadow-lg hover:bg-emerald-700 active:scale-[.98] transition-all"
              onClick={submitReport}
              disabled={loading}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8.5l4 4L14 3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Submit Report
                </>
              )}
            </button>
          )}
        </footer>

        {submitMessage && (
          <div className="mx-4 sm:mx-6 mb-4 rounded-xl bg-red-50 border border-red-200 p-3 flex items-start gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-red-500 shrink-0 mt-0.5"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <p className="text-sm text-red-700">{submitMessage}</p>
          </div>
        )}
      </div>

      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex flex-col items-center gap-3">
              <div className="success-icon flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-800" style={{ animation: "fadeUp .3s .15s ease both", opacity: 0 }}>Report Submitted!</h2>
              <p className="text-center text-sm text-slate-500" style={{ animation: "fadeUp .3s .25s ease both", opacity: 0 }}>
                Your maintenance service report has been submitted successfully.
              </p>
              {successReportCode && (
                <div className="success-code w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-700">
                    Report Code
                  </p>
                  <a href={`/admin?search=${encodeURIComponent(successReportCode)}`} className="mt-1 block text-lg font-bold tracking-[0.15em] text-[#1b3c7b] underline hover:text-emerald-700 transition-colors">
                    {successReportCode}
                  </a>
                </div>
              )}
              {successStatus && (
                <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-700">
                    Initial Ticket Status
                  </p>
                  <p className="mt-1 text-base font-bold text-amber-900">
                    {formatStatusLabel(successStatus)}
                  </p>
                </div>
              )}
            </div>
            <button
              className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white hover:bg-emerald-700 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2"
              onClick={resetForm}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M2 11V8h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Start New Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
