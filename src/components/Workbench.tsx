"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, ArrowLeftToLine, ArrowRight, ArrowRightToLine, ArrowUpDown, CaseSensitive, ChevronDown, Circle, FastForward, FilePlus2, FolderOpen, Highlighter, LogOut, Maximize, MessageSquareText, Pencil, Play, Plus, RectangleHorizontal, Rewind, RotateCcw, RotateCw, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { SearchOptions } from "@/components/PdfViewer";
import { ParametersPanel, UsersPanel } from "@/components/Administration";

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), { ssr: false });

interface PdfRecord { id: string; original_name: string; page_count: number; size_bytes: string; uploaded_at: string; document_date: string | null; }
interface OpenPdf extends PdfRecord { page: number; zoom: number; rotation: number; }
type Modal = "upload" | "library" | "windows" | "help" | null;

function ModalFrame({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (outside) onClose();
      }}
    >
      <header><h2>{title}</h2><button className="icon-button" title="Fechar" onClick={onClose}><X size={18} /></button></header>
      {children}
    </dialog>,
    document.body,
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return <details className="menu" onToggle={(event) => {
    if (!event.currentTarget.open) return;
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((menu) => {
      if (menu !== event.currentTarget) menu.open = false;
    });
  }}><summary>{label}<ChevronDown size={12} /></summary><div className="menu-popover">{children}</div></details>;
}

function MenuItem({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button disabled={disabled} onClick={(event) => { onClick(); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{children}</button>;
}

export default function Workbench({ user }: { user: SessionUser }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [openPdfs, setOpenPdfs] = useState<OpenPdf[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [library, setLibrary] = useState<PdfRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: keyof PdfRecord; direction: 1 | -1 }>({ key: "uploaded_at", direction: -1 });
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState<SearchOptions>({ query: "", wholeWord: false, caseSensitive: false, current: 0 });
  const [matches, setMatches] = useState<{ page: number; text: string }[]>([]);
  const [tool, setTool] = useState("select");
  const [annotationColor, setAnnotationColor] = useState("#f5d90a");
  const [view, setView] = useState<"viewer" | "params" | "users">("viewer");
  const active = openPdfs.find((item) => item.id === activeId) ?? null;

  const loadLibrary = useCallback(async () => {
    const response = await fetch("/api/documents");
    if (response.ok) setLibrary(await response.json());
  }, []);

  useEffect(() => {
    let activeRequest = true;
    fetch("/api/documents").then((response) => response.ok ? response.json() : []).then((data) => {
      if (activeRequest) setLibrary(data);
    });
    return () => { activeRequest = false; };
  }, []);

  function openDocument(record: PdfRecord) {
    setOpenPdfs((current) => current.some((item) => item.id === record.id) ? current : [...current, { ...record, page: 1, zoom: 100, rotation: 0 }]);
    setActiveId(record.id); setModal(null); setView("viewer");
  }

  function updateActive(values: Partial<OpenPdf>) {
    if (activeId) setOpenPdfs((current) => current.map((item) => item.id === activeId ? { ...item, ...values } : item));
  }

  function closeDocument(id = activeId) {
    if (!id) return;
    const index = openPdfs.findIndex((item) => item.id === id);
    const remaining = openPdfs.filter((item) => item.id !== id);
    setOpenPdfs(remaining);
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
  }

  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    const data = new FormData(); data.set("file", file);
    const response = await fetch("/api/documents", { method: "POST", body: data });
    const result = await response.json(); setUploading(false);
    if (!response.ok) return window.alert(result.error ?? "Falha no upload.");
    await loadLibrary(); openDocument(result);
  }

  function goMatch(index: number) {
    if (!matches.length) return;
    const next = Math.max(0, Math.min(matches.length - 1, index));
    setSearch((value) => ({ ...value, current: next })); updateActive({ page: matches[next].page });
  }

  function fitZoom(mode: "height" | "width" | "page") {
    if (!active) return;
    const scroller = document.querySelector<HTMLElement>(".pdf-scroll");
    const renderedPage = scroller?.querySelector<HTMLElement>(`.pdf-page[data-page-number="${active.page}"] .react-pdf__Page`);
    if (!scroller || !renderedPage) return;
    const bounds = renderedPage.getBoundingClientRect();
    const availableWidth = Math.max(1, scroller.clientWidth - 48);
    const availableHeight = Math.max(1, scroller.clientHeight - 48);
    const widthZoom = active.zoom * availableWidth / bounds.width;
    const heightZoom = active.zoom * availableHeight / bounds.height;
    const nextZoom = mode === "width" ? widthZoom : mode === "height" ? heightZoom : Math.min(widthZoom, heightZoom);
    updateActive({ zoom: Math.min(500, Math.max(5, Math.round(nextZoom))) });
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
  const sortedLibrary = [...library].sort((a, b) => String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""), "pt-BR", { numeric: true }) * sort.direction);

  return (
    <main className="workbench">
      <header className="app-header">
        <div className="app-title"><strong>Pats<span>XPDF</span></strong></div>
        <nav className="menu-bar">
          <Menu label="Arquivo">
            <MenuItem onClick={() => setModal("upload")}><FilePlus2 size={15} />Carregar...</MenuItem>
            <MenuItem onClick={() => setModal("library")}><FolderOpen size={15} />Abrir...</MenuItem><span className="menu-separator" />
            <MenuItem disabled={!active} onClick={() => closeDocument()}>Fechar</MenuItem>
            <MenuItem disabled={!openPdfs.length} onClick={() => { if (confirm("Fechar todos os PDFs abertos?")) { setOpenPdfs([]); setActiveId(null); } }}>Fechar todos</MenuItem><span className="menu-separator" />
            <MenuItem onClick={logout}><LogOut size={15} />Sair</MenuItem>
          </Menu>
          <Menu label="Editar"><MenuItem disabled={!active} onClick={() => setTool("select")}>Selecionar</MenuItem><MenuItem disabled={!active} onClick={() => setTool("highlight")}>Nova anotação</MenuItem></Menu>
          <Menu label="Janela">
            {openPdfs.slice(0, 20).map((item) => <MenuItem key={item.id} onClick={() => { setActiveId(item.id); setView("viewer"); }}>{item.id === activeId ? "✓ " : ""}{item.original_name}</MenuItem>)}
            {!openPdfs.length && <span className="menu-empty">Nenhum PDF aberto</span>}
            {openPdfs.length > 20 && <MenuItem onClick={() => setModal("windows")}>Mais...</MenuItem>}
          </Menu>
          <Menu label="Configurações"><MenuItem onClick={() => setView("params")}>Parâmetros</MenuItem><MenuItem onClick={() => setView("users")}>Usuários</MenuItem></Menu>
          <Menu label="Ajuda"><MenuItem onClick={() => setModal("help")}>Sobre o PatsXPDF</MenuItem></Menu>
        </nav>
        <div className="user-chip"><span>{user.name}</span><small>{user.isAdmin ? "Administrador" : user.login}</small></div>
      </header>

      <section className="toolbar" aria-label="Ferramentas do visualizador">
        {/* Toolbar for PDF navigation */}
        <div className="tool-group">
          <button title="Primeira página" disabled={!active || active.page === 1} onClick={() => updateActive({ page: 1 })}><ArrowLeftToLine size={16} /></button>
          <button title="Página anterior" disabled={!active || active.page === 1} onClick={() => updateActive({ page: Math.max(1, active!.page - 1) })}><ArrowLeft size={16} /></button>
          <input className="page-input" aria-label="Página" disabled={!active} value={active?.page ?? ""} onChange={(event) => updateActive({ page: Math.min(active!.page_count, Math.max(1, Number(event.target.value))) })} />
          <button title="Próxima página" disabled={!active || active.page === active.page_count} onClick={() => updateActive({ page: active!.page + 1 })}><ArrowRight size={16} /></button>
          <button title="Última página" disabled={!active || active.page === active.page_count} onClick={() => updateActive({ page: active!.page_count })}><ArrowRightToLine size={16} /></button>
          <span className="page-total">/ {active?.page_count.toLocaleString("pt-BR") ?? "0"} páginas</span>
        </div>
        {/* Toolbar for PDF search */}
        <div className="search-group">
          <Search size={15} />
          <input 
            placeholder="Pesquisar no PDF" 
            disabled={!active} 
            value={search.query} 
            onChange={(event) => setSearch({ ...search, query: event.target.value, current: 0 })} 
          />
          <button 
            className={search.wholeWord ? "active" : ""} 
            title="Palavra completa" 
            disabled={!active} 
            onClick={() => setSearch({ ...search, wholeWord: !search.wholeWord })}>Ab
          </button>
          <button 
            className={search.caseSensitive ? "active" : ""} 
            title="Diferenciar maiúsculas" 
            disabled={!active} 
            onClick={() => setSearch({ ...search, caseSensitive: !search.caseSensitive })}>
              <CaseSensitive size={17} />
            </button>
            <span>{matches.length ? `${search.current + 1}/${matches.length}` : "0/0"}</span>
          <button 
            title="Primeira ocorrência" 
            disabled={!matches.length} 
            onClick={() => goMatch(0)}>
              <Rewind size={15} />
          </button>
          <button 
            title="Ocorrência anterior" 
            disabled={!matches.length} 
            onClick={() => goMatch(search.current - 1)}>
              <Play size={15} style={{ transform: "scaleX(-1)" }} />
            </button>
            <button 
              title="Próxima ocorrência" 
              disabled={!matches.length} 
              onClick={() => goMatch(search.current + 1)}>
                <Play size={15} />
            </button>
            <button 
              title="Última ocorrência" 
              disabled={!matches.length} 
              onClick={() => goMatch(matches.length - 1)}>
                <FastForward size={15} />
            </button>
        </div>
        {/* Annotation controls */}
        <div className="tool-group annotation-tools">
          <button className={tool === "note" ? "active" : ""} title="Nota" disabled={!active} onClick={() => setTool("note")}><MessageSquareText size={16} /></button>
          <button className={tool === "circle" ? "active" : ""} title="Círculo" disabled={!active} onClick={() => setTool("circle")}><Circle size={16} /></button>
          <button className={tool === "rectangle" ? "active" : ""} title="Retângulo" disabled={!active} onClick={() => setTool("rectangle")}><RectangleHorizontal size={16} /></button>
          <button className={tool === "freehand" ? "active" : ""} title="Desenho livre" disabled={!active} onClick={() => setTool("freehand")}><Pencil size={16} /></button>
          <button className={tool === "highlight" ? "active" : ""} title="Destacar" disabled={!active} onClick={() => setTool("highlight")}><Highlighter size={16} /></button>
          <div className="color-picker" title="Cor da anotação">{["#f5d90a", "#8f3f0b", "#26c6da", "#3478f6", "#8b8f97", "#ef77ad", "#e5484d"].map((color) => <button key={color} aria-label={`Cor ${color}`} className={annotationColor === color ? "selected" : ""} style={{ backgroundColor: color }} onClick={() => setAnnotationColor(color)} />)}</div>
        </div>
      </section>
      {/* Document tabs */}
      <div className="document-tabs">{
        openPdfs.map((item) => 
          <button 
            className={item.id === activeId ? "active" : ""} 
            key={item.id} 
            onClick={() => { setActiveId(item.id); setView("viewer"); }}>
            <span>{item.original_name}</span>
            <X 
              size={14} 
              onClick={(event) => { event.stopPropagation(); closeDocument(item.id); }} 
            />
          </button>)}
      </div>
      {/* Workspace (PDF pages) section */}
      <section className="workspace">
        {view === "params" 
          ? <ParametersPanel /> 
          : view === "users" 
          ? <UsersPanel isAdmin={user.isAdmin} /> 
          : active 
          ? <PdfViewer 
              documentId={active.id} 
              page={active.page} 
              zoom={active.zoom} 
              rotation={active.rotation} 
              search={search} 
              tool={tool} 
              color={annotationColor} 
              onMatches={setMatches} 
              onLoad={(pages) => updateActive({ page_count: pages })} /> 
          : <div className="empty-state">
              <div className="empty-icon">
                <FolderOpen size={38} />
              </div>
              <h2>Nenhum PDF aberto</h2>
              <p>Carregue um documento local ou abra um item da biblioteca.</p>
              <div>
                <button 
                  className="primary-button" 
                  onClick={() => setModal("upload")}>
                  <Plus size={16} />Carregar PDF
                </button>
                <button 
                  className="secondary-button" 
                  onClick={() => setModal("library")}>
                  <FolderOpen size={16} />Abrir biblioteca
                </button>
              </div>
            </div>
          }
      </section>
      {/* Footer with controls for zoom & rotation */}
      <footer className="app-footer" aria-label="Controles de visualização">
        {/* Zoom controls */}
        <button title="Reduzir zoom" disabled={!active} onClick={() => updateActive({ zoom: Math.max(5, active!.zoom - 10) })}><ZoomOut size={16} /></button>
        <input className="zoom-input" aria-label="Zoom" disabled={!active} value={active ? `${active.zoom}%` : ""} onChange={(event) => updateActive({ zoom: Math.min(500, Math.max(5, Number(event.target.value.replace("%", "")))) })} />
        <button title="Ampliar zoom" disabled={!active} onClick={() => updateActive({ zoom: Math.min(500, active!.zoom + 10) })}><ZoomIn size={16} /></button>
        <button title="Ajustar à altura" disabled={!active} onClick={() => fitZoom("height")}><ArrowUpDown size={16} /></button>
        <button title="Ajustar à largura" disabled={!active} onClick={() => fitZoom("width")}><ArrowLeftRight size={16} /></button>
        <button title="Página inteira" disabled={!active} onClick={() => fitZoom("page")}><Maximize size={16} /></button>
        <span className="footer-separator" />
        {/* Rotation controls */}
        <button title="Girar à esquerda" disabled={!active} onClick={() => updateActive({ rotation: active!.rotation - 90 })}><RotateCcw size={16} /></button>
        <button title="Girar à direita" disabled={!active} onClick={() => updateActive({ rotation: active!.rotation + 90 })}><RotateCw size={16} /></button>
      </footer>
      
      {/* Modals for upload, library, windows, and help */}
      {modal === "upload" && <ModalFrame title="Carregar PDF" onClose={() => setModal(null)}><div className={`drop-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files[0]); }}><FilePlus2 size={34} /><strong>{uploading ? "Enviando..." : "Solte um PDF nesta área"}</strong><span>ou selecione um arquivo no computador</span><button className="primary-button" disabled={uploading} onClick={() => inputRef.current?.click()}>Procurar...</button><input ref={inputRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => void upload(event.target.files?.[0])} /></div></ModalFrame>}
      {modal === "library" && <ModalFrame title="Abrir PDF" wide onClose={() => setModal(null)}><div className="modal-actions"><button className="primary-button" disabled={!selectedId} onClick={() => { const record = library.find((item) => item.id === selectedId); if (record) openDocument(record); }}><FolderOpen size={16} />Abrir</button></div><div className="table-scroll"><table><thead><tr>{[["original_name", "Arquivo"], ["uploaded_at", "Data de upload"], ["document_date", "Data e hora"], ["page_count", "Páginas"]].map(([key, label]) => <th key={key} onClick={() => setSort({ key: key as keyof PdfRecord, direction: sort.key === key ? (sort.direction * -1) as 1 | -1 : 1 })}>{label}{sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : ""}</th>)}</tr></thead><tbody>{sortedLibrary.map((item) => <tr key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)} onDoubleClick={() => openDocument(item)}><td>{item.original_name}</td><td>{new Date(item.uploaded_at).toLocaleString("pt-BR")}</td><td>{item.document_date ? new Date(item.document_date).toLocaleString("pt-BR") : "-"}</td><td>{item.page_count.toLocaleString("pt-BR")}</td></tr>)}</tbody></table></div></ModalFrame>}
      {modal === "windows" && <ModalFrame title="Janelas abertas" wide onClose={() => setModal(null)}><div className="window-grid">{openPdfs.map((item) => <button key={item.id} onDoubleClick={() => { setActiveId(item.id); setModal(null); }}>{item.original_name}<small>{item.page_count} páginas</small></button>)}</div></ModalFrame>}
      {modal === "help" && <ModalFrame title="PatsXPDF" onClose={() => setModal(null)}><div className="about-content"><div className="brand-mark">P</div><h3>Visualizador e revisor de documentos</h3><p>Versão 0.1.0</p></div></ModalFrame>}
    </main>
  );
}
