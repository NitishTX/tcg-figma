"use client"

import { useState, useRef, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import axios from "axios"
import { Download, Copy, FileDown, Loader2, RefreshCw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"
import { ModeToggle } from "@/components/mode-toggle"

// API base URL - replace with your actual API URL
const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001/api"

export default function Home() {
  // State management
  const [selectedMode, setSelectedMode] = useState<string>("traditional")
  const [images, setImages] = useState<File[]>([])
  const [instructions, setInstructions] = useState<string>("")
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false)
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const [streamedContent, setStreamedContent] = useState<string>("")
  const [downloadLoading, setDownloadLoading] = useState<boolean>(false)
  const [copyLoading, setCopyLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  // Handle file drop for multiple images
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setImages((prev) => [...prev, ...acceptedFiles])
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".jpeg", ".jpg", ".png", ".gif", ".webp"],
    },
    multiple: true,
  })

  // Remove an image from the list
  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  // Handle form submission
  const handleSubmit = async () => {
    if (images.length === 0) {
      setError("Please upload at least one image")
      setTimeout(() => setError(null), 3000)
      return
    }

    setError(null)
    setIsSubmitted(true)
    setIsStreaming(true)
    setStreamedContent("")

    try {
      // Create form data
      const formData = new FormData()
      images.forEach((image) => {
        formData.append("images", image)
      })
      formData.append("language_mode", selectedMode)
      if (instructions) {
        formData.append("additional_info", instructions)
      }

      // Create EventSource for streaming response
      const response = await fetch(`${api}/generate-test-cases`, {
        method: "POST",
        body: formData,
        headers: {
          'Accept': 'text/event-stream',
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      })

      // Check if the response is successful
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // Handle streaming response using ReadableStream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        let content = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          // Process each line
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.substring(6)
              if (data === '[DONE]') {
                break
              }
              if (data) {
                content += data
                setStreamedContent(content)
                
                // Auto-scroll to bottom as content streams in
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("Error processing request:", err)
      setError("An error occurred while processing your request. Please try again.")
    } finally {
      setIsStreaming(false)
    }
  }

  // Reset the application to its initial state
  const handleReset = () => {
    // Use a smooth transition
    if (isSubmitted) {
      setStreamedContent("")
      setTimeout(() => {
        setIsSubmitted(false)
        setImages([])
        setInstructions("")
        setSelectedMode("traditional")
        setError(null)
      }, 300) // Match this with the CSS transition duration
    } else {
      setImages([])
      setInstructions("")
      setSelectedMode("traditional")
      setError(null)
    }
  }

  // Strip HTML tags from content
  const stripHtmlTags = (html: string) => {
    return html.replace(/<[^>]*>?/gm, "")
  }

  // Download Excel file
  const handleExcelDownload = async () => {
    try {
      setDownloadLoading(true)
      const cleanContent = stripHtmlTags(streamedContent)

      // Use our proxy endpoint to handle the Excel generation
      const response = await axios.post(
        `${api}/generate-excel-proxy`,
        { content: cleanContent },
        {
          responseType: "blob",
        }
      )

      // Create a download link and trigger the download
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", "test_cases.xlsx")
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Error downloading Excel:", error)
      setError("Failed to download Excel file. Please try again.")
      setTimeout(() => setError(null), 3000)
    } finally {
      setDownloadLoading(false)
    }
  }

  // Download feature file
  const downloadFeatureFile = async () => {
    try {
      setDownloadLoading(true)

      // Create a blob with the content
      const blob = new Blob([streamedContent], { type: "text/plain" })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.setAttribute("download", "feature.feature")
      document.body.appendChild(link)
      link.click()
      link.parentNode?.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Error downloading feature file:", error)
      setError("Failed to download feature file. Please try again.")
      setTimeout(() => setError(null), 3000)
    } finally {
      setDownloadLoading(false)
    }
  }

  // Copy content to clipboard
  const copyToClipboard = async () => {
    try {
      setCopyLoading(true)
      await navigator.clipboard.writeText(streamedContent)
      // Show success message or toast here if needed
    } catch (error) {
      console.error("Error copying to clipboard:", error)
      setError("Failed to copy to clipboard. Please try again.")
      setTimeout(() => setError(null), 3000)
    } finally {
      setCopyLoading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <header className="bg-background border-b border-border p-4 shadow-sm">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center">
            {/* Logo placeholder - replace with your actual logo */}
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold">
              TX
            </div>
          </div>
          <h1 className="text-lg md:text-xl font-medium hidden sm:block">
            Powered by TxGPT, AI powered test cases generator
          </h1>
          <ModeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow container mx-auto p-4 md:p-6">
        <h1 className="text-2xl md:text-3xl font-bold text-center mb-6">
          Test Cases Generator from Figma Images or URLs
        </h1>

        {/* Error message */}
        {error && <div className="bg-destructive/15 text-destructive p-3 rounded-md mb-4 text-center">{error}</div>}

        <div className="flex flex-col md:flex-row gap-6 relative">
          {/* Left Panel - Input Section */}
          <div
            className={cn(
              "transition-all duration-500 ease-in-out p-4 flex flex-col gap-4 bg-card rounded-lg shadow-md border border-border",
              isSubmitted ? "w-full md:w-[35%]" : "w-full md:w-[80%] mx-auto",
            )}
          >
            {/* Image Upload Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload Images</label>
              <div
                {...getRootProps()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors",
                  isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                  images.length > 0 ? "bg-muted/50" : "",
                )}
              >
                <input {...getInputProps()} />
                <Upload className="h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-center text-muted-foreground">Drag & drop images here, or click to select</p>
                <p className="text-xs text-muted-foreground mt-1">Supports JPG, PNG, GIF, WEBP</p>
              </div>
            </div>

            {/* Display uploaded images */}
            {images.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Uploaded Images ({images.length})</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-2 bg-muted/30 rounded-md">
                  {images.map((image, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={URL.createObjectURL(image) || "/placeholder.svg"}
                        alt={`Uploaded ${index + 1}`}
                        className="h-16 w-full object-cover rounded-md"
                      />
                      <button
                        onClick={() => removeImage(index)}
                        className="absolute top-1 right-1 bg-background/80 text-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove image"
                        disabled={isStreaming}
                      >
                        ✕
                      </button>
                      <p className="text-xs truncate mt-1">{image.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dropdown Menu */}
            <div className="space-y-2">
              <label htmlFor="test-case-language" className="text-sm font-medium">
                Select Test Cases Language
              </label>
              <Select
                value={selectedMode}
                onValueChange={setSelectedMode}
                disabled={isStreaming}
              >
                <SelectTrigger id="test-case-language">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="traditional">Traditional</SelectItem>
                  <SelectItem value="gherkin">Gherkin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Additional Instructions */}
            <div className="space-y-2">
              <label htmlFor="instructions" className="text-sm font-medium">
                Additional Instructions
              </label>
              <Textarea
                id="instructions"
                placeholder="Enter any additional instructions here..."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="min-h-[100px] resize-y"
                disabled={isStreaming}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 mt-2">
              <Button onClick={handleSubmit} className="flex-1" disabled={isStreaming || images.length === 0}>
                {isStreaming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Submit"
                )}
              </Button>
              <Button onClick={handleReset} variant="outline" className="flex-1" disabled={isStreaming}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset
              </Button>
            </div>
          </div>

          {/* Right Panel - Output Section */}
          {isSubmitted && (
            <div
              className={cn(
                "w-full md:w-[65%] transition-all duration-500 ease-in-out transform",
                isSubmitted ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
              )}
            >
              <div className="bg-card rounded-lg shadow-md p-4 h-full flex flex-col border border-border">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">Generated Test Cases</h2>
                  <div className="flex gap-2">
                    {selectedMode === "traditional" ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyToClipboard}
                          disabled={copyLoading || !streamedContent || isStreaming}
                        >
                          {copyLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Copy className="h-4 w-4 mr-1" />
                          )}
                          Copy
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleExcelDownload}
                          disabled={!streamedContent || downloadLoading}
                          className="w-full"
                        >
                          {downloadLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4 mr-1" />
                          )}
                          Download Excel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={downloadFeatureFile}
                        disabled={downloadLoading || !streamedContent || isStreaming}
                      >
                        {downloadLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileDown className="h-4 w-4 mr-1" />
                        )}
                        Download Feature
                      </Button>
                    )}
                  </div>
                </div>

                <div
                  ref={outputRef}
                  className="flex-grow overflow-auto relative bg-muted/30 p-4 rounded border border-border"
                  style={{
                    maskImage:
                      "linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)",
                  }}
                >
                  {isStreaming ? (
                    <div className="flex items-center justify-center absolute inset-0 bg-background/50 z-10">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : null}
                  <pre className="whitespace-pre-wrap font-mono text-sm">
                    {streamedContent || (isStreaming ? "Generating test cases..." : "")}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-background border-t border-border p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-bold text-xs">
            TX
          </div>
          <span className="text-sm text-center">
            © {new Date().getFullYear()} testingxperts.com. All rights reserved.
          </span>
          <div className="w-8 h-8"></div> {/* Empty div for balanced layout */}
        </div>
      </footer>
    </div>
  )
}