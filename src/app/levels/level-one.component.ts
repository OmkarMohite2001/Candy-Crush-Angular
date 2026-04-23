import { Component } from "@angular/core";
import { GameBoardComponent } from "../game-board/game-board.component";

@Component({
  selector: "app-level-one",
  standalone: true,
  imports: [GameBoardComponent],
  templateUrl: "./level-one.component.html",
  styleUrl: "./level-one.component.css",
})
export class LevelOneComponent {}
