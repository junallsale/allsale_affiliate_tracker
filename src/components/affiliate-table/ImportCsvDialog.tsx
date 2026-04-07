'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, FileSpreadsheet, Loader2 } from 'lucide-react';

interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: Record<string, string>[]) => void;
}

export default function ImportCsvDialog({
  open,
  onOpenChange,
  onImport,
}: ImportCsvDialogProps) {
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setParsedRows([]);
    setColumns([]);
    setFileName('');
    setError(null);
    setIsParsing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsParsing(true);
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        setIsParsing(false);
        if (results.errors.length > 0) {
          setError(`Parse error: ${results.errors[0].message}`);
          return;
        }
        if (!results.data.length) {
          setError('No data rows found in CSV');
          return;
        }
        const cols = results.meta.fields || Object.keys(results.data[0]);
        setColumns(cols);
        setParsedRows(results.data);
      },
      error(err) {
        setIsParsing(false);
        setError(`Failed to parse CSV: ${err.message}`);
      },
    });
  }

  function handleImport() {
    onImport(parsedRows);
    handleOpenChange(false);
  }

  const previewRows = parsedRows.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to import affiliate creators in bulk.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File upload area */}
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">
                {fileName || 'Click to upload CSV file'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepts .csv files
              </p>
            </div>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Loading state */}
          {isParsing && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Parsing CSV...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Preview */}
          {parsedRows.length > 0 && !isParsing && (
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{columns.length} columns detected</span>
                <span>{parsedRows.length} rows total</span>
              </div>

              <div className="rounded-md border border-border overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left font-medium whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {columns.map((col) => (
                          <td
                            key={col}
                            className="px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate"
                          >
                            {row[col] || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsedRows.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 5 of {parsedRows.length} rows
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedRows.length === 0 || isParsing}
          >
            Import {parsedRows.length > 0 ? `${parsedRows.length} rows` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
