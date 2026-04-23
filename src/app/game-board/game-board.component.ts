import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from "@angular/core";
import {
  destroyGameEngine,
  initializeGameEngine,
  onBoardClickEngine,
  onNewGameEngine,
} from "../game-engine";

@Component({
  selector: "app-game-board",
  standalone: true,
  templateUrl: "./game-board.component.html",
  styleUrl: "./game-board.component.css",
})
export class GameBoardComponent implements AfterViewInit, OnDestroy {
  @Input() title = "Candy Crush";
  @Input() levelNumber = 1;
  @Input() lockToLevel = false;
  @Input() storageScope = "default";
  @Input() levelReadyTemplate = "Level {level} ready. Reach {target} points!";

  @ViewChild("board", { static: true }) private readonly boardRef!: ElementRef<HTMLDivElement>;
  @ViewChild("score", { static: true }) private readonly scoreRef!: ElementRef<HTMLElement>;
  @ViewChild("moves", { static: true }) private readonly movesRef!: ElementRef<HTMLElement>;
  @ViewChild("level", { static: true }) private readonly levelRef!: ElementRef<HTMLElement>;
  @ViewChild("meterFill", { static: true }) private readonly meterFillRef!: ElementRef<HTMLElement>;
  @ViewChild("meterValue", { static: true }) private readonly meterValueRef!: ElementRef<HTMLElement>;
  @ViewChild("status", { static: true }) private readonly statusRef!: ElementRef<HTMLElement>;
  @ViewChild("announcer", { static: true }) private readonly announcerRef!: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    initializeGameEngine(
      {
        boardEl: this.boardRef.nativeElement,
        scoreEl: this.scoreRef.nativeElement,
        movesEl: this.movesRef.nativeElement,
        levelEl: this.levelRef.nativeElement,
        meterFillEl: this.meterFillRef.nativeElement,
        meterValueEl: this.meterValueRef.nativeElement,
        statusEl: this.statusRef.nativeElement,
        announcerEl: this.announcerRef.nativeElement,
      },
      {
        storageScope: this.storageScope,
        initialLevel: this.levelNumber,
        lockToLevel: this.lockToLevel,
        levelReadyTemplate: this.levelReadyTemplate,
      },
    );
  }

  ngOnDestroy(): void {
    destroyGameEngine();
  }

  onBoardClick(event: MouseEvent): void {
    onBoardClickEngine(event);
  }

  onNewGame(): void {
    onNewGameEngine();
  }
}
