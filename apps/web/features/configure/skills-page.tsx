"use client";

import { BookOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function SkillsPage({ team }: { team: string }) {
  return (
    <div className="@container flex flex-col gap-0">
      <PageHeader
        title="Skills"
        description="Reusable instructions agents can load at runtime."
        actions={
          <Button
            size="sm"
            onClick={() =>
              toast.message("Skill editor coming soon", {
                description: `Workspace: ${team}`,
              })
            }
          >
            <Plus className="size-3.5" />
            <span className="hidden md:inline">New skill</span>
          </Button>
        }
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40%]">Name</TableHead>
              <TableHead className="hidden @2xl:table-cell">Used by</TableHead>
              <TableHead className="hidden @2xl:table-cell">Source</TableHead>
              <TableHead className="hidden @2xl:table-cell">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="h-48">
                <div className="flex flex-col items-center justify-center gap-3 text-center">
                  <div className="flex size-10 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40">
                    <BookOpen className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No skills yet</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                      Skills package domain know-how — deploy steps, coding
                      standards, review checklists — so agents stay consistent.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      toast.message("Skill editor coming soon", {
                        description: `Workspace: ${team}`,
                      })
                    }
                  >
                    <Plus className="size-3.5" />
                    Create your first skill
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
