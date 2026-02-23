using System.Diagnostics;
using System.Text;

const int BoardWidth = 10;
const int BoardHeight = 20;
const int FrameDelayMs = 16;
const int StartDropMs = 550;
const int MinDropMs = 90;
const int DropStepMs = 35;
const int NextPreviewCount = 5;

var rng = new Random();
var board = new int[BoardHeight, BoardWidth];
var bag = new Queue<int>();
var nextQueue = new Queue<int>();

var current = new PieceState(0, 0, 0, 0);
int? held = null;
var canHold = true;
var score = 0;
var highScore = 0;
var level = 1;
var totalCleared = 0;
var combo = -1;
var backToBack = false;
var lastMoveWasRotation = false;
var lastRotationUsedKick = false;
var gameOver = false;
var paused = false;
var exitRequested = false;

var tetrominoes = new[]
{
    // I
    new[]
    {
        new[] { new Cell(0, 1), new Cell(1, 1), new Cell(2, 1), new Cell(3, 1) },
        new[] { new Cell(2, 0), new Cell(2, 1), new Cell(2, 2), new Cell(2, 3) },
        new[] { new Cell(0, 2), new Cell(1, 2), new Cell(2, 2), new Cell(3, 2) },
        new[] { new Cell(1, 0), new Cell(1, 1), new Cell(1, 2), new Cell(1, 3) }
    },
    // O
    new[]
    {
        new[] { new Cell(1, 0), new Cell(2, 0), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(1, 0), new Cell(2, 0), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(1, 0), new Cell(2, 0), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(1, 0), new Cell(2, 0), new Cell(1, 1), new Cell(2, 1) }
    },
    // T
    new[]
    {
        new[] { new Cell(1, 0), new Cell(0, 1), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(1, 0), new Cell(1, 1), new Cell(2, 1), new Cell(1, 2) },
        new[] { new Cell(0, 1), new Cell(1, 1), new Cell(2, 1), new Cell(1, 2) },
        new[] { new Cell(1, 0), new Cell(0, 1), new Cell(1, 1), new Cell(1, 2) }
    },
    // S
    new[]
    {
        new[] { new Cell(1, 0), new Cell(2, 0), new Cell(0, 1), new Cell(1, 1) },
        new[] { new Cell(1, 0), new Cell(1, 1), new Cell(2, 1), new Cell(2, 2) },
        new[] { new Cell(1, 1), new Cell(2, 1), new Cell(0, 2), new Cell(1, 2) },
        new[] { new Cell(0, 0), new Cell(0, 1), new Cell(1, 1), new Cell(1, 2) }
    },
    // Z
    new[]
    {
        new[] { new Cell(0, 0), new Cell(1, 0), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(2, 0), new Cell(1, 1), new Cell(2, 1), new Cell(1, 2) },
        new[] { new Cell(0, 1), new Cell(1, 1), new Cell(1, 2), new Cell(2, 2) },
        new[] { new Cell(1, 0), new Cell(0, 1), new Cell(1, 1), new Cell(0, 2) }
    },
    // J
    new[]
    {
        new[] { new Cell(0, 0), new Cell(0, 1), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(1, 0), new Cell(2, 0), new Cell(1, 1), new Cell(1, 2) },
        new[] { new Cell(0, 1), new Cell(1, 1), new Cell(2, 1), new Cell(2, 2) },
        new[] { new Cell(1, 0), new Cell(1, 1), new Cell(0, 2), new Cell(1, 2) }
    },
    // L
    new[]
    {
        new[] { new Cell(2, 0), new Cell(0, 1), new Cell(1, 1), new Cell(2, 1) },
        new[] { new Cell(1, 0), new Cell(1, 1), new Cell(1, 2), new Cell(2, 2) },
        new[] { new Cell(0, 1), new Cell(1, 1), new Cell(2, 1), new Cell(0, 2) },
        new[] { new Cell(0, 0), new Cell(1, 0), new Cell(1, 1), new Cell(1, 2) }
    }
};

Console.OutputEncoding = Encoding.UTF8;
if (Console.IsOutputRedirected || Console.IsInputRedirected)
{
    Console.WriteLine("CLI Tetris requires an interactive terminal.");
    return;
}

Console.CursorVisible = false;
Console.Clear();

SpawnNextPiece();
var dropWatch = Stopwatch.StartNew();

while (!exitRequested)
{
    HandleInput();

    if (!paused && !gameOver)
    {
        var interval = CurrentDropMs(level);
        if (dropWatch.ElapsedMilliseconds >= interval)
        {
            if (!TryMove(current.X, current.Y + 1, current.Rotation))
            {
                LockAndSpawn();
            }

            dropWatch.Restart();
        }
    }

    Render();
    Thread.Sleep(FrameDelayMs);
}

Render();
Console.SetCursorPosition(0, BoardHeight + 8);
Console.CursorVisible = true;

void HandleInput()
{
    while (Console.KeyAvailable)
    {
        var key = Console.ReadKey(true).Key;

        if (gameOver)
        {
            switch (key)
            {
                case ConsoleKey.R:
                    RestartGame();
                    dropWatch.Restart();
                    break;
                case ConsoleKey.Q:
                case ConsoleKey.Escape:
                    exitRequested = true;
                    return;
            }

            continue;
        }

        switch (key)
        {
            case ConsoleKey.LeftArrow:
            case ConsoleKey.A:
                if (!paused) TryMove(current.X - 1, current.Y, current.Rotation);
                break;
            case ConsoleKey.RightArrow:
            case ConsoleKey.D:
                if (!paused) TryMove(current.X + 1, current.Y, current.Rotation);
                break;
            case ConsoleKey.DownArrow:
            case ConsoleKey.S:
                if (!paused) SoftDropOneStep();
                break;
            case ConsoleKey.UpArrow:
            case ConsoleKey.W:
            case ConsoleKey.X:
                if (!paused) TryRotate(1);
                break;
            case ConsoleKey.Z:
                if (!paused) TryRotate(-1);
                break;
            case ConsoleKey.C:
                if (!paused) HoldPiece();
                break;
            case ConsoleKey.Spacebar:
            case ConsoleKey.Enter:
                if (!paused) HardDrop();
                break;
            case ConsoleKey.P:
                paused = !paused;
                if (!paused) dropWatch.Restart();
                break;
            case ConsoleKey.R:
                RestartGame();
                dropWatch.Restart();
                break;
            case ConsoleKey.Q:
            case ConsoleKey.Escape:
                exitRequested = true;
                break;
        }
    }
}

void SpawnNextPiece()
{
    EnsureNextQueue();
    current = new PieceState(nextQueue.Dequeue(), 3, 0, 0);
    EnsureNextQueue();
    canHold = true;
    lastMoveWasRotation = false;
    lastRotationUsedKick = false;
}

void SoftDropOneStep()
{
    if (TryMove(current.X, current.Y + 1, current.Rotation))
    {
        AddScore(1);
        return;
    }
    LockAndSpawn();
}

bool TryMove(int newX, int newY, int newRotation)
{
    if (HasCollision(newX, newY, newRotation))
    {
        return false;
    }

    current = current with { X = newX, Y = newY, Rotation = newRotation };
    lastMoveWasRotation = false;
    lastRotationUsedKick = false;
    return true;
}

bool TryRotate(int direction)
{
    var fromRotation = current.Rotation;
    var targetRotation = (fromRotation + direction + 4) % 4;

    foreach (var kick in SrsKickTests(current.Kind, fromRotation, targetRotation))
    {
        var targetX = current.X + kick.X;
        var targetY = current.Y + kick.Y;
        if (HasCollision(targetX, targetY, targetRotation)) continue;

        current = current with { X = targetX, Y = targetY, Rotation = targetRotation };
        lastMoveWasRotation = true;
        lastRotationUsedKick = kick.X != 0 || kick.Y != 0;
        return true;
    }

    return false;
}

void HardDrop()
{
    var moved = 0;
    while (TryMove(current.X, current.Y + 1, current.Rotation))
    {
        moved++;
    }

    AddScore(moved * 2);
    LockAndSpawn();
}

void HoldPiece()
{
    if (!canHold) return;

    if (held is null)
    {
        held = current.Kind;
        SpawnNextPiece();
    }
    else
    {
        var swap = held.Value;
        held = current.Kind;
        current = new PieceState(swap, 3, 0, 0);
    }

    canHold = false;
    if (HasCollision(current.X, current.Y, current.Rotation))
    {
        gameOver = true;
    }
}

void LockAndSpawn()
{
    var (isTSpin, isMiniTSpin) = DetectTSpin();
    LockPiece();
    var cleared = ClearLines();
    if (cleared > 0)
    {
        combo++;
        totalCleared += cleared;
        level = (totalCleared / 10) + 1;

        var lineScore = ScoreForClear(cleared, level, isTSpin, isMiniTSpin);
        var isDifficult = cleared == 4 || isTSpin;
        if (isDifficult && backToBack)
        {
            lineScore = (int)Math.Round(lineScore * 1.5);
        }

        if (isDifficult)
        {
            backToBack = true;
        }
        else
        {
            backToBack = false;
        }

        var comboScore = combo > 0 ? combo * 50 * level : 0;
        AddScore(lineScore + comboScore);
    }
    else
    {
        if (isTSpin)
        {
            var spinScore = ScoreForClear(0, level, true, isMiniTSpin);
            if (spinScore > 0) AddScore(spinScore);
        }

        combo = -1;
    }

    SpawnNextPiece();
    if (HasCollision(current.X, current.Y, current.Rotation))
    {
        gameOver = true;
    }
}

void LockPiece()
{
    foreach (var cell in PieceCells(current.Kind, current.Rotation))
    {
        var x = current.X + cell.X;
        var y = current.Y + cell.Y;
        if (y >= 0 && y < BoardHeight && x >= 0 && x < BoardWidth)
        {
            board[y, x] = current.Kind + 1;
        }
    }
}

int ClearLines()
{
    var cleared = 0;
    for (var y = BoardHeight - 1; y >= 0; y--)
    {
        var full = true;
        for (var x = 0; x < BoardWidth; x++)
        {
            if (board[y, x] == 0)
            {
                full = false;
                break;
            }
        }

        if (!full) continue;

        for (var row = y; row > 0; row--)
        {
            for (var col = 0; col < BoardWidth; col++)
            {
                board[row, col] = board[row - 1, col];
            }
        }

        for (var col = 0; col < BoardWidth; col++)
        {
            board[0, col] = 0;
        }

        cleared++;
        y++;
    }

    return cleared;
}

bool HasCollision(int targetX, int targetY, int targetRotation)
{
    foreach (var cell in PieceCells(current.Kind, targetRotation))
    {
        var x = targetX + cell.X;
        var y = targetY + cell.Y;

        if (x < 0 || x >= BoardWidth || y >= BoardHeight) return true;
        if (y >= 0 && board[y, x] != 0) return true;
    }

    return false;
}

void EnsureNextQueue()
{
    while (nextQueue.Count < NextPreviewCount)
    {
        if (bag.Count == 0)
        {
            var items = Enumerable.Range(0, 7).OrderBy(_ => rng.Next()).ToArray();
            foreach (var p in items) bag.Enqueue(p);
        }

        nextQueue.Enqueue(bag.Dequeue());
    }
}

int CurrentDropMs(int currentLevel)
{
    var ms = StartDropMs - ((currentLevel - 1) * DropStepMs);
    return Math.Max(ms, MinDropMs);
}

int ScoreForLines(int lines, int currentLevel)
{
    return lines switch
    {
        1 => 100 * currentLevel,
        2 => 300 * currentLevel,
        3 => 500 * currentLevel,
        4 => 800 * currentLevel,
        _ => 0
    };
}

int ScoreForClear(int lines, int currentLevel, bool isTSpin, bool isMiniTSpin)
{
    if (!isTSpin) return ScoreForLines(lines, currentLevel);

    return (isMiniTSpin, lines) switch
    {
        (true, 0) => 100 * currentLevel,
        (true, 1) => 200 * currentLevel,
        (false, 0) => 400 * currentLevel,
        (false, 1) => 800 * currentLevel,
        (false, 2) => 1200 * currentLevel,
        (false, 3) => 1600 * currentLevel,
        _ => 0
    };
}

(bool IsTSpin, bool IsMini) DetectTSpin()
{
    if (current.Kind != 2 || !lastMoveWasRotation) return (false, false);

    var pivotX = current.X + 1;
    var pivotY = current.Y + 1;
    var corners = new[]
    {
        new Cell(pivotX - 1, pivotY - 1),
        new Cell(pivotX + 1, pivotY - 1),
        new Cell(pivotX - 1, pivotY + 1),
        new Cell(pivotX + 1, pivotY + 1)
    };

    var occupied = corners.Count(c => IsCellBlocked(c.X, c.Y));
    if (occupied < 3) return (false, false);

    var frontCorners = current.Rotation switch
    {
        0 => new[] { corners[0], corners[1] },
        1 => new[] { corners[1], corners[3] },
        2 => new[] { corners[2], corners[3] },
        3 => new[] { corners[0], corners[2] },
        _ => Array.Empty<Cell>()
    };

    var frontBlocked = frontCorners.Count(c => IsCellBlocked(c.X, c.Y));
    var isMini = frontBlocked < 2;
    if (isMini && !lastRotationUsedKick)
    {
        // Without a kick, "mini" situations are usually standard T-Spins in this simplified ruleset.
        isMini = false;
    }

    return (true, isMini);
}

bool IsCellBlocked(int x, int y)
{
    if (x < 0 || x >= BoardWidth || y >= BoardHeight) return true;
    if (y < 0) return false;
    return board[y, x] != 0;
}

Cell[] SrsKickTests(int kind, int fromRotation, int toRotation)
{
    if (kind == 1) return new[] { new Cell(0, 0) };

    if (kind == 0)
    {
        return (fromRotation, toRotation) switch
        {
            (0, 1) => new[] { new Cell(0, 0), new Cell(-2, 0), new Cell(1, 0), new Cell(-2, -1), new Cell(1, 2) },
            (1, 0) => new[] { new Cell(0, 0), new Cell(2, 0), new Cell(-1, 0), new Cell(2, 1), new Cell(-1, -2) },
            (1, 2) => new[] { new Cell(0, 0), new Cell(-1, 0), new Cell(2, 0), new Cell(-1, 2), new Cell(2, -1) },
            (2, 1) => new[] { new Cell(0, 0), new Cell(1, 0), new Cell(-2, 0), new Cell(1, -2), new Cell(-2, 1) },
            (2, 3) => new[] { new Cell(0, 0), new Cell(2, 0), new Cell(-1, 0), new Cell(2, 1), new Cell(-1, -2) },
            (3, 2) => new[] { new Cell(0, 0), new Cell(-2, 0), new Cell(1, 0), new Cell(-2, -1), new Cell(1, 2) },
            (3, 0) => new[] { new Cell(0, 0), new Cell(1, 0), new Cell(-2, 0), new Cell(1, -2), new Cell(-2, 1) },
            (0, 3) => new[] { new Cell(0, 0), new Cell(-1, 0), new Cell(2, 0), new Cell(-1, 2), new Cell(2, -1) },
            _ => new[] { new Cell(0, 0) }
        };
    }

    return (fromRotation, toRotation) switch
    {
        (0, 1) => new[] { new Cell(0, 0), new Cell(-1, 0), new Cell(-1, 1), new Cell(0, -2), new Cell(-1, -2) },
        (1, 0) => new[] { new Cell(0, 0), new Cell(1, 0), new Cell(1, -1), new Cell(0, 2), new Cell(1, 2) },
        (1, 2) => new[] { new Cell(0, 0), new Cell(1, 0), new Cell(1, -1), new Cell(0, 2), new Cell(1, 2) },
        (2, 1) => new[] { new Cell(0, 0), new Cell(-1, 0), new Cell(-1, 1), new Cell(0, -2), new Cell(-1, -2) },
        (2, 3) => new[] { new Cell(0, 0), new Cell(1, 0), new Cell(1, 1), new Cell(0, -2), new Cell(1, -2) },
        (3, 2) => new[] { new Cell(0, 0), new Cell(-1, 0), new Cell(-1, -1), new Cell(0, 2), new Cell(-1, 2) },
        (3, 0) => new[] { new Cell(0, 0), new Cell(-1, 0), new Cell(-1, -1), new Cell(0, 2), new Cell(-1, 2) },
        (0, 3) => new[] { new Cell(0, 0), new Cell(1, 0), new Cell(1, 1), new Cell(0, -2), new Cell(1, -2) },
        _ => new[] { new Cell(0, 0) }
    };
}

void Render()
{
    var output = new StringBuilder();
    var ghostY = GhostDropY();

    output.AppendLine("CLI TETRIS  (←→ 이동, ↑/X 시계회전, Z 반시계회전, ↓ 소프트드롭)");
    output.AppendLine("Space/Enter 하드드롭, C 홀드, P 일시정지, R 재시작, Q 종료");
    output.AppendLine($"Score: {score}   High: {highScore}   Level: {level}   Lines: {totalCleared}");
    output.AppendLine($"Hold: {(held is null ? "-" : PieceName(held.Value))}   Next: {FormatNextPreview()}");

    output.Append('┌');
    output.Append(new string('─', BoardWidth * 2));
    output.AppendLine("┐");

    for (var y = 0; y < BoardHeight; y++)
    {
        output.Append('│');
        for (var x = 0; x < BoardWidth; x++)
        {
            if (board[y, x] != 0 || IsCurrentPieceCell(x, y))
            {
                output.Append("██");
            }
            else if (IsGhostCell(x, y, ghostY))
            {
                output.Append("░░");
            }
            else
            {
                output.Append("  ");
            }
        }
        output.AppendLine("│");
    }

    output.Append('└');
    output.Append(new string('─', BoardWidth * 2));
    output.AppendLine("┘");

    if (paused) output.AppendLine("PAUSED");
    if (gameOver) output.AppendLine("GAME OVER (R: 재시작 / Q: 종료)");

    Console.SetCursorPosition(0, 0);
    Console.Write(output.ToString());
}

bool IsCurrentPieceCell(int x, int y)
{
    foreach (var cell in PieceCells(current.Kind, current.Rotation))
    {
        if (current.X + cell.X == x && current.Y + cell.Y == y) return true;
    }
    return false;
}

string PieceName(int kind)
{
    return kind switch
    {
        0 => "I",
        1 => "O",
        2 => "T",
        3 => "S",
        4 => "Z",
        5 => "J",
        6 => "L",
        _ => "?"
    };
}

void RestartGame()
{
    for (var y = 0; y < BoardHeight; y++)
    {
        for (var x = 0; x < BoardWidth; x++)
        {
            board[y, x] = 0;
        }
    }

    bag.Clear();
    nextQueue.Clear();
    held = null;
    canHold = true;
    score = 0;
    level = 1;
    totalCleared = 0;
    combo = -1;
    backToBack = false;
    gameOver = false;
    paused = false;
    SpawnNextPiece();
}

int GhostDropY()
{
    var ghostY = current.Y;
    while (!HasCollision(current.X, ghostY + 1, current.Rotation))
    {
        ghostY++;
    }

    return ghostY;
}

bool IsGhostCell(int x, int y, int ghostY)
{
    foreach (var cell in PieceCells(current.Kind, current.Rotation))
    {
        var gx = current.X + cell.X;
        var gy = ghostY + cell.Y;
        if (gx == x && gy == y) return true;
    }

    return false;
}

Cell[] PieceCells(int kind, int rotation) => tetrominoes[kind][rotation];
string FormatNextPreview() => string.Join(' ', nextQueue.Take(NextPreviewCount).Select(PieceName));

void AddScore(int amount)
{
    if (amount <= 0) return;

    score += amount;
    if (score > highScore)
    {
        highScore = score;
    }
}

readonly record struct PieceState(int Kind, int X, int Y, int Rotation);
readonly record struct Cell(int X, int Y);
