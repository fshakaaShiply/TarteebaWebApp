import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { FileField, acceptedTypeNames, checkFile } from "./FileField";

const ACCEPT = ["application/pdf", ".pdf", "image/jpeg", ".jpg", "image/png", ".png"];
const MB = 1024 * 1024;
const file = (name: string, type: string, bytes = 1000) => new File([new Uint8Array(bytes)], name, { type });

function Harness(props: Partial<React.ComponentProps<typeof FileField>> & { onFiles?: (files: File[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <FileField
      label="Document file"
      accept={ACCEPT}
      maxBytes={10 * MB}
      value={files}
      onChange={(next) => {
        setFiles(next);
        props.onFiles?.(next);
      }}
      {...props}
    />
  );
}

describe("checkFile", () => {
  it("accepts by MIME type or extension and refuses the rest", () => {
    const rules = { accept: ACCEPT, maxBytes: 10 * MB };
    expect(checkFile(file("visa.pdf", "application/pdf"), rules)).toBeNull();
    expect(checkFile(file("photo.JPG", "image/jpeg"), rules)).toBeNull();
    // A browser that gives no type: the extension decides.
    expect(checkFile(file("scan.png", ""), rules)).toBeNull();
    expect(checkFile(file("notes.docx", "application/msword"), rules)).toBe("type");
    expect(checkFile(file("virus.pdf.exe", "application/octet-stream"), rules)).toBe("type");
    expect(checkFile(file("big.pdf", "application/pdf", 10 * MB + 1), rules)).toBe("size");
    expect(checkFile(file("exact.pdf", "application/pdf", 10 * MB), rules)).toBeNull();
    expect(checkFile(file("empty.pdf", "application/pdf", 0), rules)).toBe("empty");
  });

  it("takes any image with image/* and any file with no list", () => {
    expect(checkFile(file("a.webp", "image/webp"), { accept: ["image/*"], maxBytes: MB })).toBeNull();
    expect(checkFile(file("a.pdf", "application/pdf"), { accept: ["image/*"], maxBytes: MB })).toBe("type");
    expect(checkFile(file("a.bin", "application/octet-stream"), { accept: [], maxBytes: MB })).toBeNull();
  });

  it("names the accepted types once each", () => {
    expect(acceptedTypeNames(ACCEPT)).toEqual(["PDF", "JPG", "PNG"]);
    expect(acceptedTypeNames(["image/jpeg", ".jpeg"])).toEqual(["JPG"]);
  });
});

describe("FileField", () => {
  it("labels the real file input and says which types and size it takes", () => {
    renderWithProviders(<Harness required hint="Shown to HR only" />);
    const input = screen.getByLabelText(/Document file/);
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ACCEPT.join(","));
    expect(input).toBeRequired();
    expect(screen.getByText("PDF, JPG, PNG, up to 10 MB each")).toBeInTheDocument();
    expect(screen.getByText("Shown to HR only")).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription("Shown to HR only");
  });

  it("lists a chosen file with its size and removes it", async () => {
    const onFiles = vi.fn();
    renderWithProviders(<Harness onFiles={onFiles} />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Document file/), file("visa.pdf", "application/pdf", 2048));
    expect(onFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: "visa.pdf" })]);
    const list = screen.getByRole("list", { name: "Chosen files" });
    expect(list).toHaveTextContent("visa.pdf");
    expect(list).toHaveTextContent("2 KB");
    await user.click(screen.getByRole("button", { name: "Remove visa.pdf" }));
    expect(onFiles).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole("list", { name: "Chosen files" })).not.toBeInTheDocument();
  });

  it("turns back a wrong type or an oversized file with a message, before anything is sent", async () => {
    const onFiles = vi.fn();
    const onReject = vi.fn();
    renderWithProviders(<Harness onFiles={onFiles} onReject={onReject} />);
    const input = screen.getByLabelText(/Document file/);
    // The browser filters by `accept` in the picker; a drop does not, so the check runs on both.
    fireEvent.change(input, { target: { files: [file("notes.docx", "application/msword")] } });
    expect(await screen.findByText("notes.docx isn't an accepted file type. Use PDF, JPG, PNG.")).toHaveAttribute("role", "alert");
    fireEvent.change(input, { target: { files: [file("big.pdf", "application/pdf", 11 * MB)] } });
    expect(await screen.findByText("big.pdf is larger than 10 MB.")).toBeInTheDocument();
    expect(input).toBeInvalid();
    expect(onFiles).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ name: "big.pdf" }), "size");
    // A good file clears the message.
    fireEvent.change(input, { target: { files: [file("ok.pdf", "application/pdf")] } });
    expect(screen.queryByText(/larger than/)).not.toBeInTheDocument();
  });

  it("keeps the current file when a replacement is turned back", async () => {
    renderWithProviders(<Harness />);
    const input = screen.getByLabelText(/Document file/);
    fireEvent.change(input, { target: { files: [file("first.pdf", "application/pdf")] } });
    fireEvent.change(input, { target: { files: [file("second.docx", "application/msword")] } });
    expect(screen.getByRole("list", { name: "Chosen files" })).toHaveTextContent("first.pdf");
    expect(await screen.findByText(/second.docx isn't an accepted file type/)).toBeInTheDocument();
  });

  it("replaces the file of a single field, and adds up to maxFiles in a multiple one", () => {
    const single = renderWithProviders(<Harness />);
    const input = screen.getByLabelText(/Document file/);
    fireEvent.change(input, { target: { files: [file("a.pdf", "application/pdf")] } });
    fireEvent.change(input, { target: { files: [file("b.pdf", "application/pdf")] } });
    expect(screen.getByRole("list", { name: "Chosen files" })).toHaveTextContent("b.pdf");
    expect(screen.getByRole("list", { name: "Chosen files" })).not.toHaveTextContent("a.pdf");
    single.unmount();

    renderWithProviders(<Harness multiple maxFiles={2} accept={["image/jpeg", "image/png"]} />);
    const many = screen.getByLabelText(/Document file/);
    expect(many).toHaveAttribute("multiple");
    fireEvent.change(many, { target: { files: [file("1.jpg", "image/jpeg"), file("2.png", "image/png")] } });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.change(many, { target: { files: [file("3.jpg", "image/jpeg")] } });
    expect(screen.getByText("You can choose at most 2 files.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("takes a dropped file the same way", () => {
    const onFiles = vi.fn();
    renderWithProviders(<Harness onFiles={onFiles} />);
    const area = screen.getByText("Drag the file here, or choose it from your device").parentElement!;
    fireEvent.dragOver(area);
    expect(screen.getByText("Drop to choose")).toBeInTheDocument();
    fireEvent.drop(area, { dataTransfer: { files: [file("dropped.pdf", "application/pdf")] } });
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "dropped.pdf" })]);
  });

  it("locks while the caller uploads and says so, with progress when it knows it", () => {
    const { rerender } = renderWithProviders(<Harness busy />);
    expect(screen.getByLabelText(/Document file/)).toBeDisabled();
    expect(screen.getByText("Uploading…").closest("[role=status]")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    rerender(<Harness busy progress={42.4} />);
    expect(screen.getByRole("progressbar", { name: "Uploading…" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("Uploading… 42%").closest("[role=status]")).not.toBeNull();
  });

  it("shows the caller's own error (an upload the API refused) as an alert tied to the input", () => {
    renderWithProviders(<Harness error="The file could not be read." />);
    expect(screen.getByText("The file could not be read.")).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(/Document file/)).toHaveAccessibleDescription("The file could not be read.");
  });

  it("reads in Arabic, with logical layout and a number-free sentence for the limits", () => {
    renderWithProviders(<Harness />, { locale: "ar" });
    expect(screen.getByText("اسحب الملف إلى هنا، أو اختره من جهازك")).toBeInTheDocument();
    expect(screen.getByText("PDF، JPG، PNG، حتى 10 ميغابايت للملف")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});
